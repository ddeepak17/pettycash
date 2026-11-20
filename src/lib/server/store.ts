// Database access for runs, their timeline, purchases, approvals and rate limits.
// The login used here can reach only the pettycash schema.
import postgres from "postgres";
import type { RunEvent, RunSummary } from "../types";
import { cluster, databaseUrl } from "./config";

let client: ReturnType<typeof postgres> | null = null;
export const sql = () => {
  if (!client) client = postgres(databaseUrl(), { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 15, onnotice: () => {} });
  return client;
};
export const closeStore = async () => { if (client) { await client.end({ timeout: 2 }); client = null; } };

const ms = (d: Date | string | null) => (d ? new Date(d).getTime() : null);

// ── runs ────────────────────────────────────────────────────────────────────
export async function createRun(r: { owner: string; delegation: string; cluster: string; task: string; model: string; isHouse: boolean }): Promise<string> {
  const [row] = await sql()`insert into pettycash.runs (owner, delegation, cluster, task, model, is_house) values (${r.owner}, ${r.delegation}, ${r.cluster}, ${r.task}, ${r.model}, ${r.isHouse}) returning id`;
  return row.id as string;
}
export async function finishRun(id: string, r: { status: string; answer: string | null; spentBase: bigint }) {
  await sql()`update pettycash.runs set status = ${r.status}, answer = ${r.answer}, spent_base = ${r.spentBase.toString()}, finished_at = now() where id = ${id}`;
}
export async function setRunStatus(id: string, status: string) {
  await sql()`update pettycash.runs set status = ${status} where id = ${id}`;
}
export async function addEvent(runId: string, seq: number, e: RunEvent) {
  await sql()`insert into pettycash.events (run_id, seq, type, data) values (${runId}, ${seq}, ${e.type}, ${sql().json(e as never)}) on conflict (run_id, seq) do nothing`;
}
const toRun = (r: Record<string, unknown>): RunSummary => ({
  id: r.id as string, owner: r.owner as string, task: r.task as string, status: r.status as string, answer: (r.answer as string) ?? null,
  spentBase: String(r.spent_base), isHouse: r.is_house as boolean, createdAt: ms(r.created_at as Date)!, finishedAt: ms(r.finished_at as Date | null),
});
export async function getRun(id: string): Promise<{ run: RunSummary; delegation: string; events: RunEvent[] } | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [row] = await sql()`select * from pettycash.runs where id = ${id}`;
  if (!row) return null;
  const events = await sql()`select data from pettycash.events where run_id = ${id} order by seq`;
  return { run: toRun(row), delegation: row.delegation as string, events: events.map((e) => e.data as RunEvent) };
}
export async function activeRunFor(owner: string): Promise<string | null> {
  const [row] = await sql()`select id from pettycash.runs where owner = ${owner} and status in ('running', 'awaiting_approval') and created_at > now() - interval '10 minutes' limit 1`;
  return (row?.id as string) ?? null;
}

// ── purchases ───────────────────────────────────────────────────────────────
export type PurchaseRow = {
  id: string; run_id: string | null; owner: string; cluster: string; kind: "tool" | "reasoning"; tool_id: string | null; step: number;
  seller_url: string; seller_host: string; seller_name: string | null; method: string; pay_to: string; mint: string; amount_base: string;
  status: string; pull_sig: string | null; pay_sig: string | null; refund_sig: string | null; pay_memo: string | null; http_status: number | null;
  response_sha256: string | null; response_bytes: number | null; response_preview: string | null; error: string | null;
  unresolved_until: Date | null; created_at: Date; quote: unknown; policy: unknown;
};
export async function insertPurchase(p: {
  runId: string | null; owner: string; cluster: string; kind: "tool" | "reasoning"; toolId: string | null; step: number; sellerUrl: string; sellerHost: string;
  sellerName: string; method: string; payTo: string; mint: string; amountBase: bigint; quote: unknown; policy: unknown; status: string;
}): Promise<string> {
  const s = sql();
  const [row] = await s`insert into pettycash.purchases (run_id, owner, cluster, kind, tool_id, step, seller_url, seller_host, seller_name, method, pay_to, mint, amount_base, quote, policy, status)
    values (${p.runId}, ${p.owner}, ${p.cluster}, ${p.kind}, ${p.toolId}, ${p.step}, ${p.sellerUrl}, ${p.sellerHost}, ${p.sellerName}, ${p.method}, ${p.payTo}, ${p.mint}, ${p.amountBase.toString()},
      ${s.json(p.quote as never)}, ${s.json(p.policy as never)}, ${p.status}) returning id`;
  return row.id as string;
}
export async function updatePurchase(id: string, patch: Partial<{
  status: string; pull_sig: string; pay_sig: string | null; refund_sig: string; pay_memo: string | null; http_status: number | null; response_sha256: string | null;
  response_bytes: number; response_preview: string; error: string | null; unresolved_until: Date | null;
}>) {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  const s = sql();
  await s`update pettycash.purchases set ${s(Object.fromEntries(entries) as Record<string, unknown>)}, updated_at = now() where id = ${id}`;
}
export async function getPurchase(id: string): Promise<PurchaseRow | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [row] = await sql()`select * from pettycash.purchases where id = ${id}`;
  return (row as unknown as PurchaseRow) ?? null;
}
export const purchasesForRun = async (runId: string) => (await sql()`select * from pettycash.purchases where run_id = ${runId} order by created_at`) as unknown as PurchaseRow[];
export const purchasesForOwner = async (owner: string, limit: number) =>
  (await sql()`select * from pettycash.purchases where owner = ${owner} and cluster = ${cluster()} and status <> 'denied' order by created_at desc limit ${limit}`) as unknown as PurchaseRow[];
export const housePurchases = async (limit: number) =>
  (await sql()`select p.* from pettycash.purchases p join pettycash.runs r on r.id = p.run_id where r.is_house and p.cluster = ${cluster()} and p.pull_sig is not null order by p.created_at desc limit ${limit}`) as unknown as PurchaseRow[];
export const unresolvedPurchases = async (owner?: string) =>
  (await (owner
    ? sql()`select * from pettycash.purchases where status in ('refund_pending', 'pulled') and refund_sig is null and cluster = ${cluster()} and owner = ${owner} order by created_at limit 20`
    : sql()`select * from pettycash.purchases where status in ('refund_pending', 'pulled') and refund_sig is null and cluster = ${cluster()} order by created_at limit 20`)) as unknown as PurchaseRow[];

/** Per-seller record built from our own purchases: how many were paid and how many were delivered. */
export async function sellerRecords(): Promise<Record<string, { purchases: number; delivered: number }>> {
  const rows = await sql()`select coalesce(tool_id, kind) as id, count(*) filter (where pay_sig is not null or status in ('paid', 'delivered'))::int as purchases,
    count(*) filter (where status = 'delivered')::int as delivered from pettycash.purchases where cluster = ${cluster()} group by 1`;
  return Object.fromEntries(rows.map((r) => [r.id as string, { purchases: r.purchases as number, delivered: r.delivered as number }]));
}

// ── approvals ───────────────────────────────────────────────────────────────
export async function setApproval(purchaseId: string, decision: "approved" | "denied") {
  await sql()`insert into pettycash.approvals (purchase_id, decision) values (${purchaseId}, ${decision}) on conflict (purchase_id) do nothing`;
}
export async function waitForApproval(purchaseId: string, timeoutMs: number, signal?: AbortSignal): Promise<"approved" | "denied" | "timed_out"> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !signal?.aborted) {
    const [row] = await sql()`select decision from pettycash.approvals where purchase_id = ${purchaseId}`;
    if (row) return row.decision === "approved" ? "approved" : "denied";
    await new Promise((r) => setTimeout(r, 700));
  }
  return "timed_out";
}

// ── rate limits and settings ────────────────────────────────────────────────
/** Fixed-window counter. Returns true while the caller is within the limit. */
export async function withinRateLimit(key: string, limit: number, windowSecs: number): Promise<boolean> {
  const [row] = await sql()`
    insert into pettycash.rate_limits (key, count, window_start) values (${key}, 1, now())
    on conflict (key) do update set
      count = case when pettycash.rate_limits.window_start < now() - make_interval(secs => ${windowSecs}) then 1 else pettycash.rate_limits.count + 1 end,
      window_start = case when pettycash.rate_limits.window_start < now() - make_interval(secs => ${windowSecs}) then now() else pettycash.rate_limits.window_start end
    returning count`;
  return (row.count as number) <= limit;
}
export async function getSetting<T>(key: string): Promise<T | null> {
  const [row] = await sql()`select value from pettycash.settings where key = ${key}`;
  return (row?.value as T) ?? null;
}
export async function setSetting(key: string, value: unknown) {
  const s = sql();
  await s`insert into pettycash.settings (key, value) values (${key}, ${s.json(value as never)}) on conflict (key) do update set value = excluded.value, updated_at = now()`;
}

// ── artifacts ───────────────────────────────────────────────────────────────
export async function saveArtifact(purchaseId: string, contentType: string, bytes: Buffer) {
  await sql()`insert into pettycash.artifacts (purchase_id, content_type, bytes) values (${purchaseId}, ${contentType}, ${bytes}) on conflict (purchase_id) do nothing`;
}
export async function getArtifact(purchaseId: string): Promise<{ contentType: string; bytes: Buffer } | null> {
  if (!/^[0-9a-f-]{36}$/.test(purchaseId)) return null;
  const [row] = await sql()`select content_type, bytes from pettycash.artifacts where purchase_id = ${purchaseId}`;
  return row ? { contentType: row.content_type as string, bytes: row.bytes as Buffer } : null;
}

/** Takes exclusive ownership of a purchase's refund. Only one caller gets true, so money is never returned twice. */
export async function claimRefund(id: string): Promise<boolean> {
  const rows = await sql()`update pettycash.purchases set status = 'refunding', updated_at = now() where id = ${id} and status in ('refund_pending', 'pulled') and refund_sig is null returning id`;
  return rows.length === 1;
}
/** Releases stale claims (a process that stopped mid-refund) so they are retried. */
export async function releaseStaleRefundClaims() {
  await sql()`update pettycash.purchases set status = 'refund_pending', unresolved_until = now() where status = 'refunding' and refund_sig is null and updated_at < now() - interval '3 minutes'`;
}
