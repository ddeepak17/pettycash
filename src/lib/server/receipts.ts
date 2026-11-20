// Turns stored purchases into receipts. A receipt is "verified" only when QuickNode Streams delivered BOTH of its
// transactions and the Stream's own numbers match what was agreed: the owner paid exactly the quoted amount to the
// agent, and the agent paid exactly that amount of the quoted token to the quoted recipient.
// Nothing the agent or the seller says can set `verified`.
import { checkReceipt } from "../stream/match";
import { findPaymentProof, getProofs } from "../stream/store";
import type { Receipt, StreamProof } from "../types";
import { agentPublicKey } from "./config";
import { updatePurchase, type PurchaseRow } from "./store";

const STATUS: Record<string, Receipt["status"]> = {
  denied: "denied", awaiting_approval: "awaiting_approval", pulling: "pulled", pulled: "pulled", paying: "pulled", paid: "paid", delivered: "delivered",
  failed: "failed", refunded: "refunded", refund_pending: "failed", refunding: "failed", quoted: "failed",
};
/** A seller's address without the query string. The query can hold the person's search words, which stay private. */
const publicUrl = (url: string) => url.split("?")[0];

export async function toReceipts(rows: PurchaseRow[]): Promise<Receipt[]> {
  const agent = agentPublicKey().toBase58();
  const signatures = rows.flatMap((r) => [r.pull_sig, r.pay_sig]).filter((s): s is string => !!s);
  const proofs = await getProofs(signatures).catch(() => new Map<string, StreamProof>());
  const out: Receipt[] = [];
  for (const r of rows) {
    const pullProof = r.pull_sig ? proofs.get(r.pull_sig) ?? null : null;
    let payProof = r.pay_sig ? proofs.get(r.pay_sig) ?? null : null;
    let paySignature = r.pay_sig;
    // The seller did not tell us which transaction paid it. The Stream can: look for the exact transfer after the pull.
    if (!paySignature && pullProof && (r.status === "delivered" || r.status === "paid" || r.status === "paying")) {
      payProof = await findPaymentProof({ agent, payTo: r.pay_to, mint: r.mint, amountBase: String(r.amount_base), afterSlot: pullProof.slot - 1, memo: r.pay_memo ?? undefined, purchaseId: r.id }).catch(() => null);
      if (payProof) {
        paySignature = payProof.signature;
        await updatePurchase(r.id, { pay_sig: payProof.signature }).catch(() => {});
      }
    }
    const pullCheck = checkReceipt(pullProof, { kind: "pull", agent, owner: r.owner, mint: r.mint, amountBase: String(r.amount_base) });
    let payCheck = checkReceipt(payProof, { kind: "payment", agent, payTo: r.pay_to, mint: r.mint, amountBase: String(r.amount_base) });
    // Two purchases from the same seller at the same price move the same amounts. Only the transaction carrying this
    // purchase's own random note is its payment.
    if (payCheck.verified && payProof && r.pay_memo && !(payProof.memos ?? []).includes(r.pay_memo))
      payCheck = { verified: false, mismatch: "The payment the Stream delivered does not carry this purchase's own note, so it may belong to a different purchase." };
    out.push({
      id: r.id, runId: r.run_id, owner: r.owner, kind: r.kind,
      seller: { id: r.tool_id, name: r.seller_name ?? r.seller_host, host: r.seller_host, url: publicUrl(r.seller_url) },
      payTo: r.pay_to, amountBase: String(r.amount_base), status: STATUS[r.status] ?? "failed",
      pullSignature: r.pull_sig, paySignature, refundSignature: r.refund_sig, httpStatus: r.http_status,
      responseSha256: r.response_sha256, responseBytes: r.response_bytes, createdAt: new Date(r.created_at).getTime(),
      pullProof, payProof, verified: pullCheck.verified && payCheck.verified, mismatch: pullCheck.mismatch ?? payCheck.mismatch,
    });
  }
  return out;
}
