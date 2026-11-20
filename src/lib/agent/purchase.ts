// One purchase, start to finish:
//
//   quote (unpaid) -> rule check -> ask a person if needed -> build and check the payment (nothing sent yet)
//   -> pull the exact price from the owner's wallet under the petty cash -> send the payment -> record the result.
//
// Money moves in exactly two places: `pull` (owner -> agent, limited by Solana's Allowances program) and the
// x402 payment (agent -> seller, checked instruction by instruction before it is sent).
//
// Nothing here trusts a seller's word about money. A purchase stays "open" until our own read of the chain
// confirms its payment. If the payment never lands, the money goes back to the owner, exactly once. Enough is
// written to the database BEFORE each transaction is broadcast that a purchase interrupted at any point (server
// stopped, RPC timeout) can be settled later from chain state alone: see settleUnresolved().
import { PublicKey, type Connection } from "@solana/web3.js";
import { formatUsd } from "../solana/cluster";
import { buildPayment, getQuote, sendPayment, type Quote, type SellerRequest } from "../x402/client";
import type { RunEvent, SellerRef } from "../types";
import { agentKeypair, agentPublicKey, cluster, network, usdcMint } from "../server/config";
import { ChainRefused, pull, readAllowance, refund } from "../server/agentWallet";
import { allRpcUrls, currentBlockHeight, PAYMENT_VALID_BLOCKS, pinned, signatureOutcome, TransactionFailed } from "../server/rpc";
import { claimRefund, insertPurchase, moveStatus, openPurchases, paySignatureTaken, recordRefundAttempt, releaseRefund, saveArtifact, setRunStatus, touchPurchase, updatePurchase, waitForApproval, type PurchaseRow } from "../server/store";
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
  /** `paid` is what may have left the petty cash for good; the errand's budget counts it. */
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

/** After a seller fails or goes quiet, how long before we even look for the payment. The decision itself never
 *  rests on time alone: money is only returned once a finalized block is past the last height the payment could land at. */
const GRACE_MS = Number(process.env.UNRESOLVED_GRACE_MS ?? 20_000);
/** Rehearsals on a local validator may skip the wait for blockhash expiry. Never honoured on mainnet. */
const trustWindowOnly = () => process.env.REHEARSAL_TRUST_WINDOW_ONLY === "1" && cluster() !== "mainnet-beta";

export async function purchase(ctx: PurchaseContext, target: PurchaseTarget): Promise<PurchaseOutcome> {
  const sellerRef: SellerRef = { id: target.toolId, name: target.seller.name, host: target.seller.host, url: target.request.url.split("?")[0] };
  const mint = usdcMint();
  const want = { network: network(), asset: mint.toBase58() };

  // 1. Ask for the price. Nothing is paid or signed here.
  const q = await getQuote(target.request, want);
  if (q.kind === "error") return { ok: false, purchaseId: null, stage: "quote", error: q.error, chainRefused: false, paid: 0n };
  if (q.kind === "free") return { ok: true, purchaseId: "", amount: 0n, text: q.body, contentType: null };
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
  if (!live) return failed("policy", "This petty cash no longer exists onchain. It was revoked or has been closed.");

  // 3. Build, sign and check the payment BEFORE any money moves. Signing needs no balance. If the payment cannot
  //    be built, or is not exactly the quoted transfer, we stop here and nothing has left the owner's wallet.
  const built = await buildPayment(quote, agentKeypair().secretKey, { rpcUrls: allRpcUrls(), mint: mint.toBase58() });
  if (!built.ok) {
    await updatePurchase(purchaseId, { status: "failed", error: built.error });
    return failed("payment", `${built.error} Nothing was spent.`);
  }
  const payment = built.payment;
  // The payment was built just now, so it cannot land after this block height. That is what later tells us,
  // with certainty, when an unconfirmed payment is dead and the money may go back.
  const payLastValidHeight = await currentBlockHeight().then((h) => h + PAYMENT_VALID_BLOCKS).catch(() => null);
  if (payLastValidHeight === null) {
    await updatePurchase(purchaseId, { status: "failed", error: "Solana could not be reached to prepare the payment." });
    return failed("payment", "Solana could not be reached just now. Nothing was spent.");
  }

  // 4. Pull exactly the price from the owner's wallet. Solana's Allowances program decides whether this is allowed.
  //    The pull's signature and the payment's memo are on record before the pull is broadcast.
  let pulled: { signature: string; slot: number; ms: number };
  let pullSigned = false;
  try {
    pulled = await pull(live, amount, async (signature, lastValidBlockHeight) => {
      await updatePurchase(purchaseId, { status: "pulling", pull_sig: signature, pull_last_valid_height: lastValidBlockHeight, pay_memo: payment.memo, pay_blockhash: payment.blockhash, pay_last_valid_height: payLastValidHeight });
      pullSigned = true;
    }, purchaseId);
  } catch (e) {
    if (e instanceof ChainRefused) {
      await updatePurchase(purchaseId, { status: "failed", error: `Refused by Solana: ${e.plain}` });
      await ctx.emit({ type: "chain_refused", purchaseId, code: e.code, name: e.name, plain: e.plain });
      return failed("pull", e.plain, { chainRefused: true });
    }
    if (e instanceof TransactionFailed && e.signature === null) {
      // Simulation failed: the transaction was never broadcast, so no money moved.
      await updatePurchase(purchaseId, { status: "failed", error: "The transfer from the wallet failed." });
      return failed("pull", "The money could not be moved from the wallet. Nothing was spent.");
    }
    // Once the pull was signed and broadcast, this code never calls it failed: only the chain can say that.
    if (pullSigned) return failed("pull", "The transfer from the wallet could not be confirmed. If it did go through, the money is returned automatically within a few minutes.", { refund: { status: "pending" } });
    await updatePurchase(purchaseId, { status: "failed", error: "The transfer from the wallet could not be sent." }).catch(() => {});
    return failed("pull", "The money could not be moved from the wallet. Nothing was spent.");
  }
  // From here on a payment may be in flight. The row stays open until the chain itself settles the question.
  // Compare-and-set: if a reconciler already took this slow purchase over (and is returning the money), the payment
  // that was built is never sent.
  if (!(await moveStatus(purchaseId, "pulling", "paying", { unresolved_until: new Date(Date.now() + target.timeoutMs + GRACE_MS) })))
    return failed("pull", "This purchase took too long and was cancelled before any payment was sent. The money is returned to the wallet.", { refund: { status: "pending" } });
  await ctx.emit({ type: "pulled", purchaseId, signature: pulled.signature, amountBase: amount.toString(), remainingBase: (live.remaining > amount ? live.remaining - amount : 0n).toString(), ms: pulled.ms });

  // 5. Send the payment that was built and checked in step 3.
  const paid = await sendPayment(quote, payment, target.timeoutMs);
  const delivered = paid.httpStatus !== null && paid.httpStatus >= 200 && paid.httpStatus < 300 && !paid.error;
  // A seller's reported signature is shown to the person as a link, and nothing more. It is never stored as this
  // purchase's payment: that is recorded only once the chain (our own read, or the Stream) shows a transaction that
  // carries this purchase's note and moves exactly the quoted amount.
  const reported = paid.signature;

  if (delivered) {
    await moveStatus(purchaseId, "paying", "delivered", {
      unresolved_until: new Date(Date.now() + GRACE_MS), http_status: paid.httpStatus, response_sha256: paid.sha256,
      response_bytes: paid.bodyBytes, response_preview: preview(paid.bodyText, 600),
    });
    await ctx.emit({ type: "paid", purchaseId, signature: reported, httpStatus: paid.httpStatus!, ms: paid.ms });
    const image = findImage(paid.bodyText);
    if (image) await saveArtifact(purchaseId, image.contentType, image.bytes).catch(() => {});
    await ctx.emit({ type: "delivered", purchaseId, bytes: paid.bodyBytes, sha256: paid.sha256 ?? "", preview: image ? `[an image, ${Math.round(image.bytes.length / 1024)} KB]` : preview(paid.bodyText) });
    return { ok: true, purchaseId, amount, text: paid.bodyText, contentType: paid.contentType };
  }

  // The seller did not deliver. Whether it was paid is decided by the chain, not by what it told us.
  await updatePurchase(purchaseId, { http_status: paid.httpStatus, error: paid.error, unresolved_until: new Date(Date.now() + GRACE_MS) });
  if (paid.settled && reported) {
    await ctx.emit({ type: "paid", purchaseId, signature: reported, httpStatus: paid.httpStatus ?? 0, ms: paid.ms });
    return failed("delivery", `${target.seller.name} reported taking the payment of ${formatUsd(amount)} but did not deliver (HTTP ${paid.httpStatus}). We are checking the chain; if the payment did not land, the money is returned.`, { paid: amount });
  }
  return failed("payment", `${paid.error ?? "The seller did not confirm the payment."} If the payment did not go through, the money returns to the wallet within a few minutes.`, { refund: { status: "pending" }, paid: amount });
}

// ── Reconciliation ───────────────────────────────────────────────────────────

const memoMatches = (field: string | null | undefined, memo: string) =>
  !!field && field.split("; ").some((part) => part.replace(/^\[\d+\]\s*/, "") === memo);
const refundNote = (id: string) => `pettycash:refund:${id}`;
const MAX_HISTORY_PAGES = 20;
const MAX_CANDIDATES = 20;

/** `reachedPull`: the pull itself was seen. `complete`: the history was read to its very beginning. If neither is
 *  true we ran out of pages, and nothing may be concluded from what is missing. */
type History = { reachedPull: boolean; complete: boolean; payments: string[]; refunds: string[] };

/** Reads the agent token account's transactions back to this purchase's pull, all from ONE endpoint, and picks out
 *  the successful ones that carry the payment's memo or this purchase's refund note. Throws when the endpoint
 *  cannot be read, so the caller's failover moves on to the next endpoint. */
async function historySincePull(c: Connection, p: PurchaseRow, commitment: "confirmed" | "finalized", minContextSlot?: number): Promise<History> {
  const agentAta = ata(agentPublicKey(), new PublicKey(p.mint));
  const out: History = { reachedPull: false, complete: false, payments: [], refunds: [] };
  let before: string | undefined;
  for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
    const sigs = await c.getSignaturesForAddress(agentAta, { limit: 1000, before, minContextSlot }, commitment);
    for (const s of sigs) {
      if (s.signature === p.pull_sig) { out.reachedPull = true; return out; }
      if (s.err) continue;
      if (p.pay_memo && memoMatches(s.memo, p.pay_memo)) out.payments.push(s.signature);
      if (memoMatches(s.memo, refundNote(p.id))) out.refunds.push(s.signature);
    }
    if (sigs.length < 1000) { out.complete = true; return out; }
    before = sigs[sigs.length - 1].signature;
  }
  return out;
}

type TokenBalance = { owner?: string; mint: string; uiTokenAmount: { amount: string } };
type TxMeta = { err: unknown; logs: string[]; pre: TokenBalance[]; post: TokenBalance[] };

/** Reads one transaction's result straight from the RPC as JSON. We only need its outcome, logs and token balances,
 *  so this does not depend on the client library understanding the transaction's message format. Sellers'
 *  facilitators settle some payments as version 1 transactions, which older client code refuses to decode. */
async function transactionMeta(c: Connection, signature: string): Promise<TxMeta | null | "unknown"> {
  try {
    const res = await fetch(c.rpcEndpoint, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [signature, { commitment: "confirmed", maxSupportedTransactionVersion: 1, encoding: "json" }] }),
    });
    if (!res.ok) return "unknown";
    const j = (await res.json()) as { error?: unknown; result?: { meta?: { err: unknown; logMessages?: string[]; preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] } } | null };
    if (j.error) return "unknown";
    if (!j.result || !j.result.meta) return null;
    const m = j.result.meta;
    return { err: m.err, logs: m.logMessages ?? [], pre: m.preTokenBalances ?? [], post: m.postTokenBalances ?? [] };
  } catch { return "unknown"; }
}

/** Decides whether one transaction is exactly this purchase's payment: it succeeded, it carries this purchase's own
 *  note, the agent's holdings of the token fell by the amount and the recipient's rose by it. `listed` means the
 *  chain's own history named the signature, so "not found" from a node is treated as unknown, never as no. */
async function isThePayment(c: Connection, signature: string, p: PurchaseRow, listed: boolean): Promise<boolean | "unknown"> {
  const meta = await transactionMeta(c, signature);
  if (meta === "unknown") return "unknown";
  if (!meta) return listed ? "unknown" : false;
  if (meta.err) return false;
  if (p.pay_memo) {
    const memos = meta.logs.flatMap((l) => { const m = /Memo \(len \d+\): "(.*)"$/.exec(l); return m ? [m[1]] : []; });
    if (!memos.includes(p.pay_memo)) return false;
  }
  const agent = agentPublicKey().toBase58();
  const sum = (list: TokenBalance[], owner: string) => list.filter((b) => b.owner === owner && b.mint === p.mint).reduce((n, b) => n + BigInt(b.uiTokenAmount.amount), 0n);
  const delta = (owner: string) => sum(meta.post, owner) - sum(meta.pre, owner);
  const amount = BigInt(p.amount_base);
  return delta(agent) === -amount && delta(p.pay_to) === amount;
}

/** Looks for this purchase's payment. Returns its signature, null when it is certain there is none in the history
 *  read (which must reach back to the pull itself), or "unknown" when we cannot be certain. We never guess.
 *  Only transactions the chain's own history lists with this purchase's note are considered. */
async function lookForPayment(c: Connection, p: PurchaseRow, commitment: "confirmed" | "finalized", minContextSlot?: number): Promise<string | null | "unknown"> {
  const h = await historySincePull(c, p, commitment, minContextSlot);
  if (h.payments.length > MAX_CANDIDATES) return "unknown"; // someone is flooding the history with our memo: do not guess
  for (const signature of h.payments) {
    // A transaction carrying OUR note that another purchase has recorded as its own means something is wrong.
    // Stop and leave it open rather than conclude "no payment" and refund.
    if (await paySignatureTaken(signature, p.id).catch(() => true)) return "unknown";
    const match = await isThePayment(c, signature, p, true);
    if (match === "unknown") return "unknown";
    if (match) return signature;
  }
  return h.reachedPull ? null : "unknown";
}

/** "dead" only when it is certain the signed transaction can never land and has not landed: a finalized block is
 *  past its last valid height, and the history read AFTER that, on the same endpoint, at finalized commitment and not
 *  older than that same finalized slot, does not contain it. Slot and height come from one call, so they describe
 *  one state of the chain. The order matters: reading the history first would miss a transaction landing in between. */
async function afterItsLastChance<T>(lastValidHeight: number, look: (c: Connection, finalizedSlot: number) => Promise<T | null | "unknown">): Promise<T | "dead" | "wait"> {
  try {
    return await pinned(async (c) => {
      const { absoluteSlot, blockHeight } = await c.getEpochInfo("finalized");
      if (blockHeight === undefined || blockHeight <= lastValidHeight) return "wait" as const;
      const found = await look(c, absoluteSlot);
      return found === null ? ("dead" as const) : found === "unknown" ? ("wait" as const) : found;
    });
  } catch { return "wait"; }
}

/** Returns a purchase's money to its owner exactly once.
 *  - Only the holder of the claim may send it, and only that holder may give the claim back.
 *  - Before sending, the chain is searched for a refund that already carries this purchase's note. If one landed
 *    (for example one we lost track of), it is recorded and nothing more is sent.
 *  - The refund's signature is written down before broadcast, under the claim. If the claim was lost, nothing is broadcast. */
async function refundPurchase(p: PurchaseRow): Promise<string | null> {
  const claim = await claimRefund(p.id);
  if (!claim) { debug(p.id.slice(0, 8), "refund already claimed elsewhere"); return null; }
  const release = () => releaseRefund(p.id, claim, null).catch(() => false);
  const prior = await pinned((c) => historySincePull(c, p, "confirmed")).catch(() => null);
  if (!prior || !prior.reachedPull) { debug(p.id.slice(0, 8), "history does not reach the pull; not refunding"); await release(); return null; }
  if (prior.refunds.length) {
    await moveStatus(p.id, "refunding", "refunded", { refund_sig: prior.refunds[0], unresolved_until: null });
    return prior.refunds[0];
  }
  try {
    const back = await refund(new PublicKey(p.owner), BigInt(p.amount_base), async (signature, lastValidBlockHeight) => {
      if (!(await recordRefundAttempt(p.id, claim, signature, lastValidBlockHeight))) throw new Error("refund claim lost before broadcast");
    }, p.id);
    await moveStatus(p.id, "refunding", "refunded", { refund_sig: back.signature, unresolved_until: null });
    return back.signature;
  } catch (e) {
    debug(p.id.slice(0, 8), "refund did not confirm:", e instanceof Error ? e.message.slice(0, 200) : e);
    // Simulation failed: it was never signed for broadcast and nothing moved, so the claim goes back to the queue.
    if (e instanceof TransactionFailed && e.signature === null) await release();
    // If the claim was lost, someone else holds the row: leave it alone. If it was broadcast with an unknown
    // outcome, the row stays "refunding" with its recorded signature and is settled from the chain.
    return null;
  }
}

const debug = (...a: unknown[]) => { if (process.env.DEBUG_SETTLE === "1") console.log("[settle]", ...a); };

/**
 * Settles every purchase whose money is not yet accounted for. Safe to run from several places at once: every
 * state change is a compare-and-set, and a refund in flight can only be released by a caller that saw that same attempt.
 *
 *   pulling         the pull was signed but never confirmed here  -> landed: return the money; certainly never landed: nothing moved
 *   paying          a payment was sent and the seller failed       -> found onchain: "paid"; can never land: return the money
 *   delivered/paid  the seller answered                            -> found onchain: settled; can never land: return the money
 *   refund_pending  the money must go back                         -> return it
 *   refunding       a refund was signed but never confirmed here   -> found onchain by its note: done; can never land: try again
 */
export async function settleUnresolved(owner?: string): Promise<{ checked: number; refunded: number; foundPaid: number; stillOpen: number }> {
  const rows = await openPurchases(owner);
  let refunded = 0, foundPaid = 0, stillOpen = 0;
  const now = Date.now();
  for (const p of rows) {
    const waiting = p.unresolved_until ? new Date(p.unresolved_until).getTime() > now : false;
    const age = p.age_s ?? (now - new Date(p.updated_at).getTime()) / 1000;
    try {
      if (p.status === "pulling") {
        if (age < 75) { stillOpen++; continue; } // the purchase itself is probably still confirming this pull
        const takeBack = async () => { if ((await moveStatus(p.id, "pulling", "refund_pending")) && (await refundPurchase(p))) refunded++; else stillOpen++; };
        const outcome = await signatureOutcome(p.pull_sig!, null);
        debug(p.id.slice(0, 8), "pulling, pull outcome:", outcome);
        if (outcome === "landed") { await takeBack(); continue; }
        if (outcome === "failed") { await moveStatus(p.id, "pulling", "failed", { settled_at: new Date(), error: "The transfer from the wallet failed. Nothing was spent." }); continue; }
        // Not seen. It is only certain that it never landed once a finalized block is past its last valid height AND
        // the agent account's whole history, read after that, does not contain it.
        if (p.pull_last_valid_height === null) { await touchPurchase(p.id); stillOpen++; continue; }
        const verdict = await afterItsLastChance(Number(p.pull_last_valid_height), async (c, slot) => {
          const h = await historySincePull(c, p, "finalized", slot);
          return h.reachedPull ? ("landed" as const) : h.complete ? null : ("unknown" as const);
        });
        if (verdict === "landed") await takeBack();
        else if (verdict === "dead") await moveStatus(p.id, "pulling", "failed", { settled_at: new Date(), error: "The transfer from the wallet did not go through. Nothing was spent." });
        else { await touchPurchase(p.id); stillOpen++; }
      } else if (p.status === "pulled") {
        if ((await moveStatus(p.id, "pulled", "refund_pending")) && (await refundPurchase(p))) refunded++; else stillOpen++;
      } else if (p.status === "paying" || p.status === "delivered" || p.status === "paid") {
        if (p.status === "paying" && waiting) { stillOpen++; continue; } // the seller may still be answering
        const settle = async (signature: string) => {
          if (await moveStatus(p.id, p.status, p.status === "paying" ? "paid" : p.status, { pay_sig: signature, settled_at: new Date(), unresolved_until: null,
            ...(p.status === "paying" ? { error: `${p.error ?? "The seller did not deliver."} The payment did reach the seller.` } : {}) })) foundPaid++;
        };
        const found = await pinned((c) => lookForPayment(c, p, "confirmed")).catch(() => "unknown" as const);
        debug(p.id.slice(0, 8), p.status, "found:", found, "waiting:", waiting, "lastValid:", p.pay_last_valid_height);
        if (found === "unknown") { await touchPurchase(p.id); stillOpen++; continue; }
        if (found) { await settle(found); continue; }
        if (waiting || p.pay_last_valid_height === null) { await touchPurchase(p.id); stillOpen++; continue; }
        // No payment yet. Money goes back only when the signed payment is certain never to land.
        const verdict = trustWindowOnly() ? ("dead" as const) : await afterItsLastChance(Number(p.pay_last_valid_height), (c, slot) => lookForPayment(c, p, "finalized", slot));
        debug(p.id.slice(0, 8), "verdict:", verdict);
        if (verdict === "wait") { await touchPurchase(p.id); stillOpen++; }
        else if (verdict === "dead") { if ((await moveStatus(p.id, p.status, "refund_pending", { pay_sig: null })) && (await refundPurchase(p))) refunded++; else stillOpen++; }
        else await settle(verdict);
      } else if (p.status === "refund_pending") {
        if (await refundPurchase(p)) refunded++; else stillOpen++;
      } else if (p.status === "refunding") {
        if (age < 60) { stillOpen++; continue; } // someone is sending it right now
        const lookRefund = async (c: Connection, slot?: number) => { const h = await historySincePull(c, p, slot === undefined ? "confirmed" : "finalized", slot); return h.refunds[0] ?? (h.reachedPull ? null : ("unknown" as const)); };
        const seen = await pinned((c) => lookRefund(c)).catch(() => "unknown" as const);
        if (seen !== null && seen !== "unknown") { if (await moveStatus(p.id, "refunding", "refunded", { refund_sig: seen, unresolved_until: null })) refunded++; continue; }
        if (seen === "unknown") { await touchPurchase(p.id); stillOpen++; continue; }
        // No refund with this purchase's note is onchain. The claim is released only by a caller that saw this exact
        // attempt (same claim, same recorded signature), so a stale copy of the row can never undo a newer attempt.
        if (!p.refund_try_sig) { await releaseRefund(p.id, p.refund_claim, null); stillOpen++; continue; }
        const verdict = p.refund_try_height === null ? "wait" : await afterItsLastChance(Number(p.refund_try_height), (c, slot) => lookRefund(c, slot));
        if (verdict === "wait") { await touchPurchase(p.id); stillOpen++; }
        else if (verdict === "dead") { await releaseRefund(p.id, p.refund_claim, p.refund_try_sig); stillOpen++; }
        else if (await moveStatus(p.id, "refunding", "refunded", { refund_sig: verdict, unresolved_until: null })) refunded++;
      }
    } catch (e) {
      console.error("settle failed for purchase", p.id, e instanceof Error ? e.message : e);
      await touchPurchase(p.id).catch(() => {});
      stillOpen++;
    }
  }
  return { checked: rows.length, refunded, foundPaid, stillOpen };
}
