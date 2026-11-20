// One purchase, start to finish:
//   quote (unpaid) -> rule check -> ask a person if needed -> pull the exact price from the owner's wallet under
//   the petty cash -> pay the seller over x402 -> record what came back -> give the money back if it did not complete.
//
// Money moves in exactly two places: `pull` (owner -> agent, limited by Solana's Allowances program) and
// `payQuote` (agent -> seller, checked instruction by instruction before it is sent).
import { PublicKey } from "@solana/web3.js";
import { formatUsd } from "../solana/cluster";
import { getQuote, payQuote, type Quote, type SellerRequest } from "../x402/client";
import type { RunEvent, SellerRef } from "../types";
import { agentKeypair, agentPublicKey, cluster, network, usdcMint } from "../server/config";
import { ChainRefused, pull, readAllowance, refund } from "../server/agentWallet";
import { primaryRpcUrl, read } from "../server/rpc";
import { insertPurchase, updatePurchase, waitForApproval, setRunStatus, unresolvedPurchases, saveArtifact, claimRefund, releaseStaleRefundClaims, type PurchaseRow } from "../server/store";
import { ata } from "../solana/allowances";
import { decide, type PolicyDecision } from "./policy";

export type PurchaseTarget = {
  kind: "tool" | "reasoning";
  toolId: string | null;
  seller: { name: string; host: string; payTo: string; maxPrice: bigint; alwaysAsk?: boolean };
  request: SellerRequest;
  timeoutMs: number;
};

export type PurchaseContext = {
  runId: string | null;
  owner: PublicKey;
  allowance: PublicKey;
  step: number;
  /** False on the public demo petty cash: nobody is there to approve, so "ask" becomes "no". */
  canAsk: boolean;
  limits: { perPurchaseMax: bigint; approvalThreshold: bigint; runBudget: bigint; approvalWaitMs: number };
  spentInRun: bigint;
  emit: (e: RunEvent) => Promise<void> | void;
  signal?: AbortSignal;
};

export type PurchaseOutcome =
  | { ok: true; purchaseId: string; amount: bigint; text: string; contentType: string | null }
  | { ok: false; purchaseId: string | null; stage: "quote" | "policy" | "pull" | "payment" | "delivery"; error: string; chainRefused: boolean; paid: bigint };

const preview = (text: string, n = 1200) => (text.length > n ? `${text.slice(0, n)}…` : text);

/** Finds an inline base64 image in a seller's JSON response (PNG, JPEG or WebP, up to 4 MB). Checks the file signature. */
export function findImage(body: string): { contentType: string; bytes: Buffer } | null {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return null; }
  let best: string | null = null;
  const walk = (v: unknown, depth: number) => {
    if (depth > 6 || v === null) return;
    if (typeof v === "string") { const s = v.replace(/^data:image\/[a-z+]+;base64,/, ""); if (s.length > 2000 && s.length < 6_000_000 && /^[A-Za-z0-9+/=\s]+$/.test(s.slice(0, 400)) && (!best || s.length > best.length)) best = s; return; }
    if (Array.isArray(v)) { v.slice(0, 20).forEach((x) => walk(x, depth + 1)); return; }
    if (typeof v === "object") Object.values(v as Record<string, unknown>).slice(0, 40).forEach((x) => walk(x, depth + 1));
  };
  walk(parsed, 0);
  if (!best) return null;
  const bytes = Buffer.from(best as string, "base64");
  if (bytes.length > 4_000_000) return null;
  const contentType = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? "image/png"
    : bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg"
    : bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP" ? "image/webp" : null;
  return contentType ? { contentType, bytes } : null;
}
/** How long after a payment was signed it can still land: Solana blockhashes live about 60 to 90 seconds; we wait longer. */
const UNRESOLVED_WINDOW_MS = Number(process.env.UNRESOLVED_WINDOW_MS ?? 150_000);
/** A purchase stuck at "pulled" for this long was abandoned before a payment existed. */
const STALE_PULL_MS = Number(process.env.STALE_PULL_MS ?? 6 * 60_000);

export async function purchase(ctx: PurchaseContext, target: PurchaseTarget): Promise<PurchaseOutcome> {
  const sellerRef: SellerRef = { id: target.toolId, name: target.seller.name, host: target.seller.host, url: target.request.url };
  const mint = usdcMint();
  const want = { network: network(), asset: mint.toBase58() };

  // 1. Ask for the price. Nothing is paid or signed here.
  const q = await getQuote(target.request, want);
  if (q.kind === "error") {
    return { ok: false, purchaseId: null, stage: "quote", error: q.error, chainRefused: false, paid: 0n };
  }
  if (q.kind === "free") {
    return { ok: true, purchaseId: "", amount: 0n, text: q.body, contentType: null };
  }
  const quote: Quote = q.quote;
  const amount = BigInt(quote.offer.amount);

  // 2. Rule check against the live onchain state of the petty cash.
  const live = await readAllowance(ctx.allowance);
  const policy: PolicyDecision = decide({
    offer: { scheme: quote.offer.scheme, network: quote.offer.network, asset: quote.offer.asset, payTo: quote.offer.payTo, amount },
    expected: { network: want.network, asset: want.asset, seller: target.seller },
    limits: ctx.limits,
    state: { spentInRun: ctx.spentInRun, allowanceRemaining: live?.remaining ?? 0n, allowanceExpired: live ? live.expired : false, allowanceMissing: !live },
  });
  const purchaseId = await insertPurchase({
    runId: ctx.runId, owner: ctx.owner.toBase58(), cluster: cluster(), kind: target.kind, toolId: target.toolId, step: ctx.step,
    sellerUrl: target.request.url, sellerHost: target.seller.host, sellerName: target.seller.name, method: target.request.method,
    payTo: quote.offer.payTo, mint: mint.toBase58(), amountBase: amount,
    quote: { offer: quote.offer, offers: quote.offers, description: quote.description, x402Version: quote.x402Version, quotedAt: quote.quotedAt },
    policy, status: policy.decision === "deny" ? "denied" : policy.decision === "ask" ? "awaiting_approval" : "quoted",
  });
  await ctx.emit({ type: "quote", purchaseId, step: ctx.step, kind: target.kind, seller: sellerRef, amountBase: amount.toString(), payTo: quote.offer.payTo, description: quote.description || `${target.seller.name} request` });
  await ctx.emit({ type: "policy", purchaseId, decision: policy.decision, checks: policy.checks });

  const failed = async (stage: "policy" | "pull" | "payment" | "delivery", error: string, opts: { chainRefused?: boolean; refund?: null | { status: "refunded"; signature: string } | { status: "pending" }; paid?: bigint } = {}): Promise<PurchaseOutcome> => {
    await ctx.emit({ type: "purchase_failed", purchaseId, stage, error, refund: opts.refund ?? null });
    return { ok: false, purchaseId, stage, error, chainRefused: opts.chainRefused ?? false, paid: opts.paid ?? 0n };
  };

  if (policy.decision === "deny") return failed("policy", policy.reason);
  if (policy.decision === "ask") {
    if (!ctx.canAsk) {
      await updatePurchase(purchaseId, { status: "denied", error: "Needs a person's approval, which the public demo cannot give." });
      return failed("policy", `${policy.reason} This needs a person's approval, which the public demo cannot give.`);
    }
    const expiresAt = Date.now() + ctx.limits.approvalWaitMs;
    if (ctx.runId) await setRunStatus(ctx.runId, "awaiting_approval");
    await ctx.emit({ type: "approval_needed", purchaseId, amountBase: amount.toString(), seller: sellerRef, reason: policy.reason, expiresAt });
    const decision = await waitForApproval(purchaseId, ctx.limits.approvalWaitMs, ctx.signal);
    if (ctx.runId) await setRunStatus(ctx.runId, "running");
    await ctx.emit({ type: "approval_result", purchaseId, decision });
    if (decision !== "approved") {
      await updatePurchase(purchaseId, { status: "denied", error: decision === "denied" ? "You said no." : "Nobody answered in time." });
      return failed("policy", decision === "denied" ? "You said no to this purchase." : "Nobody approved this purchase in time.");
    }
  }

  // 3. Pull exactly the price from the owner's wallet. Solana's Allowances program decides whether this is allowed.
  let pulled: { signature: string; slot: number; ms: number };
  try {
    if (!live) throw new ChainRefused(null, "allowanceMissing", "This petty cash no longer exists onchain. It was revoked or has been closed.", null, []);
    pulled = await pull(live, amount);
  } catch (e) {
    if (e instanceof ChainRefused) {
      await updatePurchase(purchaseId, { status: "failed", error: `Refused by Solana: ${e.plain}` });
      await ctx.emit({ type: "chain_refused", purchaseId, code: e.code, name: e.name, plain: e.plain });
      return failed("pull", e.plain, { chainRefused: true });
    }
    const msg = e instanceof Error ? e.message : "The pull did not go through.";
    await updatePurchase(purchaseId, { status: "failed", error: msg });
    return failed("pull", "The money could not be moved from the wallet. Nothing was spent.");
  }
  await updatePurchase(purchaseId, { status: "pulled", pull_sig: pulled.signature });
  const after = await readAllowance(ctx.allowance).catch(() => null);
  await ctx.emit({ type: "pulled", purchaseId, signature: pulled.signature, amountBase: amount.toString(), remainingBase: (after?.remaining ?? (live.remaining - amount)).toString(), ms: pulled.ms });

  // 4. Pay the seller. The signed transfer is checked against the quote before it leaves this process.
  //    Before sending, we record the payment's memo and mark the outcome as open, so that if this server stops
  //    mid-purchase the reconciler can still find the payment onchain or return the money.
  const paid = await payQuote(quote, agentKeypair().secretKey, {
    rpcUrl: primaryRpcUrl(), mint: mint.toBase58(), timeoutMs: target.timeoutMs,
    beforeSend: (memo) => updatePurchase(purchaseId, { status: "refund_pending", pay_memo: memo, unresolved_until: new Date(Date.now() + UNRESOLVED_WINDOW_MS + target.timeoutMs) }),
  });

  if (!paid.sent) {
    // The payment never left, so nobody else holds a signed transfer: giving the money back now is safe.
    await updatePurchase(purchaseId, { status: "refund_pending", error: paid.error, unresolved_until: new Date() });
    const back = await refundPurchase(purchaseId, ctx.owner, amount);
    return failed("payment", paid.error ?? "The payment could not be sent.", { refund: back ? { status: "refunded", signature: back } : { status: "pending" } });
  }

  const delivered = paid.httpStatus !== null && paid.httpStatus >= 200 && paid.httpStatus < 300;
  if (delivered) {
    await updatePurchase(purchaseId, {
      status: "delivered", pay_sig: paid.signature, pay_memo: paid.memo, unresolved_until: null, http_status: paid.httpStatus, response_sha256: paid.sha256,
      response_bytes: paid.bodyBytes, response_preview: preview(paid.bodyText, 600),
    });
    await ctx.emit({ type: "paid", purchaseId, signature: paid.signature, httpStatus: paid.httpStatus!, ms: paid.ms });
    const image = findImage(paid.bodyText);
    if (image) await saveArtifact(purchaseId, image.contentType, image.bytes).catch(() => {});
    await ctx.emit({ type: "delivered", purchaseId, bytes: paid.bodyBytes, sha256: paid.sha256 ?? "", preview: image ? `[an image, ${Math.round(image.bytes.length / 1024)} KB]` : preview(paid.bodyText) });
    return { ok: true, purchaseId, amount, text: paid.bodyText, contentType: paid.contentType };
  }

  // The payment was sent but the seller did not deliver.
  if (paid.settled && paid.signature) {
    // The seller reported taking the money and still failed. We record that honestly; x402 has no refund from a seller.
    await updatePurchase(purchaseId, { status: "paid", pay_sig: paid.signature, pay_memo: paid.memo, unresolved_until: null, http_status: paid.httpStatus, error: paid.error });
    await ctx.emit({ type: "paid", purchaseId, signature: paid.signature, httpStatus: paid.httpStatus ?? 0, ms: paid.ms });
    return failed("delivery", `${target.seller.name} took the payment of ${formatUsd(amount)} but did not deliver (HTTP ${paid.httpStatus}).`, { paid: amount });
  }
  // Outcome unknown: the signed payment may still land until its blockhash expires. Decide later, never guess.
  await updatePurchase(purchaseId, { status: "refund_pending", pay_memo: paid.memo, http_status: paid.httpStatus, error: paid.error, unresolved_until: new Date(Date.now() + UNRESOLVED_WINDOW_MS) });
  return failed("payment", `${paid.error ?? "The seller did not confirm the payment."} If the payment did not go through, the money returns to the wallet within a few minutes.`, { refund: { status: "pending" } });
}

/** Returns a purchase's money to its owner exactly once. Returns the refund signature, or null if someone else is
 *  already handling it or the transfer failed (it is then retried by the reconciler). */
async function refundPurchase(purchaseId: string, owner: PublicKey, amount: bigint): Promise<string | null> {
  if (!(await claimRefund(purchaseId))) return null;
  try {
    const back = await refund(owner, amount);
    await updatePurchase(purchaseId, { status: "refunded", refund_sig: back.signature });
    return back.signature;
  } catch {
    await updatePurchase(purchaseId, { status: "refund_pending", unresolved_until: new Date(Date.now() + 30_000) });
    return null;
  }
}

/** Settles purchases whose outcome was unclear: if the payment landed, record it; if it can no longer land, return the money. */
export async function settleUnresolved(owner?: string): Promise<{ checked: number; refunded: number; foundPaid: number }> {
  await releaseStaleRefundClaims().catch(() => {});
  const rows: PurchaseRow[] = await unresolvedPurchases(owner);
  let refunded = 0, foundPaid = 0;
  const agentAta = ata(agentPublicKey(), usdcMint());
  for (const p of rows) {
    if (p.unresolved_until && new Date(p.unresolved_until).getTime() > Date.now()) continue;
    // A row still marked "pulled" means the server stopped before any payment was built: nothing could have been paid.
    if (p.status === "pulled" && Date.now() - new Date(p.created_at).getTime() < STALE_PULL_MS) continue;
    // Look for the payment by its random memo among the agent token account's recent transactions.
    let landed: string | null = null;
    if (p.status !== "pulled") {
      // A payment was signed. Without its memo we cannot tell whether it landed, so we never refund on a guess.
      if (!p.pay_memo) continue;
      const sigs = await read((c) => c.getSignaturesForAddress(agentAta, { limit: 500 }, "confirmed")).catch(() => null);
      if (sigs === null) continue; // could not check: try again later rather than risk a double payment
      landed = sigs.find((s) => !s.err && s.memo?.includes(p.pay_memo!))?.signature ?? null;
    }
    if (landed) {
      await updatePurchase(p.id, { status: "paid", pay_sig: landed, unresolved_until: null, error: `${p.error ?? "The seller did not deliver."} The payment did reach the seller.` });
      foundPaid++;
      continue;
    }
    if (await refundPurchase(p.id, new PublicKey(p.owner), BigInt(p.amount_base))) refunded++;
  }
  return { checked: rows.length, refunded, foundPaid };
}
