// Folds RunEvents into something a screen can draw, whether they arrive live or are replayed from a saved run.
import type { PolicyCheck, RunEvent, SellerRef } from "../types";

export type Purchase = {
  id: string; seller: SellerRef; amountBase: string; description: string; kind: "reasoning" | "tool";
  decision?: "allow" | "ask" | "deny"; checks?: PolicyCheck[];
  approval?: { reason: string; expiresAt: number; result?: "approved" | "denied" | "timed_out" };
  pulled?: { signature: string; remainingBase: string; ms: number };
  refused?: { code: number | null; name: string; plain: string };
  paid?: { signature: string | null; httpStatus: number; ms: number };
  delivered?: { bytes: number; preview: string };
  failed?: { stage: string; error: string; refund: null | { status: string; signature?: string } };
};
export type Item = { kind: "thinking"; step: number; text: string } | { kind: "purchase"; id: string } | { kind: "answer"; text: string } | { kind: "error"; message: string };
export type RunState = {
  phase: "idle" | "running" | "done" | "failed" | "stopped";
  runId: string | null; task: string; budgetBase: string | null; remainingBase: string | null; spentBase: bigint;
  items: Item[]; purchases: Record<string, Purchase>; finish: null | { purchases: number; ms: number; spentBase: string };
};
export const emptyRun: RunState = { phase: "idle", runId: null, task: "", budgetBase: null, remainingBase: null, spentBase: 0n, items: [], purchases: {}, finish: null };

export function reduceRun(s: RunState, e: RunEvent): RunState {
  const upd = (id: string, f: (p: Purchase) => Purchase): RunState => (s.purchases[id] ? { ...s, purchases: { ...s.purchases, [id]: f(s.purchases[id]) } } : s);
  switch (e.type) {
    case "run_started": return { ...emptyRun, phase: "running", runId: e.runId, task: e.task, budgetBase: e.runBudgetBase, remainingBase: e.remainingBase };
    case "thinking": return { ...s, items: [...s.items, { kind: "thinking", step: e.step, text: e.text }] };
    case "quote": return { ...s, items: [...s.items, { kind: "purchase", id: e.purchaseId }], purchases: { ...s.purchases, [e.purchaseId]: { id: e.purchaseId, seller: e.seller, amountBase: e.amountBase, description: e.description, kind: e.kind } } };
    case "policy": return upd(e.purchaseId, (p) => ({ ...p, decision: e.decision, checks: e.checks }));
    case "approval_needed": return upd(e.purchaseId, (p) => ({ ...p, approval: { reason: e.reason, expiresAt: e.expiresAt } }));
    case "approval_result": return upd(e.purchaseId, (p) => ({ ...p, approval: { reason: p.approval?.reason ?? "", expiresAt: p.approval?.expiresAt ?? 0, result: e.decision } }));
    case "pulled": return { ...upd(e.purchaseId, (p) => ({ ...p, pulled: { signature: e.signature, remainingBase: e.remainingBase, ms: e.ms } })), remainingBase: e.remainingBase, spentBase: s.spentBase + BigInt(e.amountBase) };
    case "chain_refused": return upd(e.purchaseId, (p) => ({ ...p, refused: { code: e.code, name: e.name, plain: e.plain } }));
    case "paid": return upd(e.purchaseId, (p) => ({ ...p, paid: { signature: e.signature, httpStatus: e.httpStatus, ms: e.ms } }));
    case "delivered": return upd(e.purchaseId, (p) => ({ ...p, delivered: { bytes: e.bytes, preview: e.preview } }));
    case "purchase_failed": return upd(e.purchaseId, (p) => ({ ...p, failed: { stage: e.stage, error: e.error, refund: e.refund } }));
    case "answer": return { ...s, items: [...s.items, { kind: "answer", text: e.text }] };
    case "run_finished": return { ...s, phase: e.status, finish: { purchases: e.purchases, ms: e.ms, spentBase: e.spentBase } };
    case "error": return { ...s, phase: s.phase === "running" ? "failed" : s.phase, items: [...s.items, { kind: "error", message: e.message }] };
  }
}
export const foldRun = (events: RunEvent[]) => events.reduce(reduceRun, emptyRun);
