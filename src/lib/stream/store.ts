// Database access for the Streams pipeline: what QuickNode delivered, the webhook replay guard, and settings.
// The login role's search_path is the pettycash schema, so tables are named without a prefix.
import postgres from "postgres";
import type { StreamProof } from "../types";
import { checkReceipt, type Movement, type StreamMatch } from "./match";

type Sql = ReturnType<typeof postgres>;
const holder = globalThis as { __pettycashStreamSql?: Sql };

function db(): Sql {
  if (!holder.__pettycashStreamSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    // idle_timeout matters on serverless: an instance can be frozen between requests, and a query sent down a
    // connection that died meanwhile would hang. Idle connections are closed after 20 seconds and reopened on demand.
    holder.__pettycashStreamSql = postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 15, max_lifetime: 300, onnotice: () => {} });
  }
  return holder.__pettycashStreamSql;
}

/** Closes the connection (scripts and tests; the deployed app never needs it). */
export async function closeStore(): Promise<void> {
  const sql = holder.__pettycashStreamSql;
  holder.__pettycashStreamSql = undefined;
  if (sql) await sql.end({ timeout: 5 });
}

/** One delivered transaction. `payload` is the filter's object, stored as it arrived. */
export type DeliveryRow = { signature: string; slot: number; blockTime: number | null; ok: boolean; payload: StreamMatch; streamId: string | null };

export const toDeliveryRows = (matches: StreamMatch[], streamId: string | null): DeliveryRow[] =>
  matches.map((m) => ({ signature: m.signature, slot: m.slot, blockTime: m.blockTime, ok: m.ok, payload: m, streamId }));

const records = (rows: DeliveryRow[]) => {
  const seen = new Set<string>();
  const out: { signature: string; slot: number; block_time: number | null; ok: boolean; payload: StreamMatch; stream_id: string | null }[] = [];
  for (const r of rows) {
    if (seen.has(r.signature)) continue;
    seen.add(r.signature);
    out.push({ signature: r.signature, slot: r.slot, block_time: r.blockTime, ok: r.ok, payload: r.payload, stream_id: r.streamId });
  }
  return out;
};
// Text in, cast in SQL: independent of how the driver would guess the parameter's type.
const asJson = (v: unknown) => JSON.stringify(v);

/** Stores deliveries. Idempotent: a signature that is already stored is left untouched. Returns how many were new. */
export async function saveDeliveries(rows: DeliveryRow[]): Promise<number> {
  if (!rows.length) return 0;
  const sql = db();
  const saved = await sql`
    insert into stream_deliveries (signature, slot, block_time, ok, payload, stream_id)
    select r.signature, r.slot, r.block_time, r.ok, r.payload, r.stream_id
    from jsonb_to_recordset(${asJson(records(rows))}::text::jsonb) as r(signature text, slot bigint, block_time bigint, ok boolean, payload jsonb, stream_id text)
    on conflict (signature) do nothing
    returning signature`;
  return saved.length;
}

/** Replay guard. True the first time a nonce is seen, false ever after. */
export async function claimNonce(nonce: string): Promise<boolean> {
  const sql = db();
  const claimed = await sql`insert into webhook_nonces (nonce) values (${nonce}) on conflict (nonce) do nothing returning nonce`;
  return claimed.length === 1;
}

/**
 * The webhook's write: claim the nonce and store the deliveries in ONE statement, so they succeed or fail together.
 * If storing fails the nonce is not consumed, and QuickNode's retry of the same delivery is processed, not dropped.
 * `fresh` is false when the nonce had been seen before; nothing is stored in that case.
 */
export async function recordDelivery(nonce: string, rows: DeliveryRow[]): Promise<{ fresh: boolean; saved: number }> {
  const sql = db();
  const [result] = await sql`
    with claimed as (
      insert into webhook_nonces (nonce) values (${nonce}) on conflict (nonce) do nothing returning nonce
    ), saved as (
      insert into stream_deliveries (signature, slot, block_time, ok, payload, stream_id)
      select r.signature, r.slot, r.block_time, r.ok, r.payload, r.stream_id
      from jsonb_to_recordset(${asJson(records(rows))}::text::jsonb) as r(signature text, slot bigint, block_time bigint, ok boolean, payload jsonb, stream_id text)
      where exists (select 1 from claimed)
      on conflict (signature) do nothing
      returning signature
    )
    select (select count(*) from claimed)::int as claimed, (select count(*) from saved)::int as saved`;
  return { fresh: result.claimed === 1, saved: result.saved };
}

type ProofRow = { signature: string; slot: string | number; block_time: string | number | null; ok: boolean; payload: unknown; received_ms: string | number };

function movementsOf(payload: unknown): Movement[] {
  const list = typeof payload === "object" && payload !== null ? (payload as { movements?: unknown }).movements : null;
  if (!Array.isArray(list)) return [];
  return list
    .filter((m): m is Movement => typeof m === "object" && m !== null && typeof m.owner === "string" && typeof m.mint === "string" && typeof m.deltaBase === "string")
    .map((m) => ({ owner: m.owner, mint: m.mint, deltaBase: m.deltaBase }));
}

function toProof(row: ProofRow): StreamProof {
  const blockTime = row.block_time === null ? null : Number(row.block_time);
  return {
    signature: row.signature,
    slot: Number(row.slot),
    blockTime,
    ok: row.ok === true,
    // Milliseconds from the block's time to our receipt. Block times are whole seconds, so this is never below 0;
    // it is 0 when the block carried no time.
    receivedAt: blockTime === null ? 0 : Math.max(0, Number(row.received_ms) - blockTime * 1000),
    movements: movementsOf(row.payload),
    memos: Array.isArray((row.payload as { memos?: unknown })?.memos) ? ((row.payload as { memos: unknown[] }).memos.filter((m) => typeof m === "string") as string[]) : [],
  };
}

/** What the Stream delivered for each of these signatures. Signatures it has not delivered are absent from the map. */
export async function getProofs(signatures: string[]): Promise<Map<string, StreamProof>> {
  const out = new Map<string, StreamProof>();
  const wanted = [...new Set(signatures.filter((s) => typeof s === "string" && s.length > 0))];
  if (!wanted.length) return out;
  const sql = db();
  for (let i = 0; i < wanted.length; i += 500) {
    const rows = await sql<ProofRow[]>`
      select signature, slot, block_time, ok, payload, (extract(epoch from received_at) * 1000)::bigint as received_ms
      from stream_deliveries where signature in ${sql(wanted.slice(i, i + 500))}`;
    for (const row of rows) out.set(row.signature, toProof(row));
  }
  return out;
}

/**
 * Finds the payment when the seller did not report its signature: a delivered, successful transaction in a slot
 * after `afterSlot` in which `payTo` gained exactly `amountBase` of `mint` and the agent lost exactly that much.
 *
 * Several purchases can have the same seller and price, so one payment must not prove two receipts:
 *  - a transaction already recorded as another purchase's pay_sig is skipped (pass `purchaseId` so a purchase's
 *    own recorded payment is not skipped);
 *  - `memo`, when the caller knows the memo it put in the payment, must be among the transaction's memos;
 *  - `excludeSignatures` are skipped;
 *  - of what remains, the earliest slot wins.
 */
export async function findPaymentProof(q: {
  agent: string;
  payTo: string;
  mint: string;
  amountBase: string;
  afterSlot: number;
  memo?: string;
  purchaseId?: string;
  excludeSignatures?: string[];
}): Promise<StreamProof | null> {
  if (!/^\d{1,40}$/.test(q.amountBase) || BigInt(q.amountBase) <= BigInt(0)) return null;
  const amount = BigInt(q.amountBase).toString();
  const afterSlot = Number.isFinite(q.afterSlot) ? Math.floor(q.afterSlot) : 0;
  const gained = asJson([{ owner: q.payTo, mint: q.mint, deltaBase: amount }]);
  const lost = asJson([{ owner: q.agent, mint: q.mint, deltaBase: `-${amount}` }]);
  const own = q.purchaseId && /^[0-9a-fA-F-]{36}$/.test(q.purchaseId) ? q.purchaseId : null;
  const excluded = new Set(q.excludeSignatures ?? []);
  const sql = db();
  const rows = await sql<ProofRow[]>`
    select d.signature, d.slot, d.block_time, d.ok, d.payload, (extract(epoch from d.received_at) * 1000)::bigint as received_ms
    from stream_deliveries d
    where d.ok and d.slot > ${afterSlot}
      and d.payload->'movements' @> ${gained}::text::jsonb
      and d.payload->'movements' @> ${lost}::text::jsonb
      ${q.memo ? sql`and d.payload->'memos' @> ${asJson([q.memo])}::text::jsonb` : sql``}
      and not exists (select 1 from purchases p where p.pay_sig = d.signature ${own ? sql`and p.id <> ${own}::uuid` : sql``})
    order by d.slot asc, d.received_at asc
    limit 50`;
  for (const row of rows) {
    if (excluded.has(row.signature)) continue;
    const proof = toProof(row);
    // The SQL narrows the search; the same pure rule that verifies receipts makes the decision.
    if (checkReceipt(proof, { kind: "payment", agent: q.agent, payTo: q.payTo, mint: q.mint, amountBase: amount }).verified) return proof;
  }
  return null;
}

// ── Settings (small key-value rows) ──────────────────────────────────────────
export async function getSetting<T = unknown>(key: string): Promise<{ value: T; updatedAt: number } | null> {
  const sql = db();
  const [row] = await sql<{ value: T; updated_ms: string | number }[]>`
    select value, (extract(epoch from updated_at) * 1000)::bigint as updated_ms from settings where key = ${key}`;
  return row ? { value: row.value, updatedAt: Number(row.updated_ms) } : null;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const sql = db();
  await sql`
    insert into settings (key, value) values (${key}, ${asJson(value)}::text::jsonb)
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
}

/** Counts for the health endpoint. */
export async function deliveryStats(): Promise<{ deliveries: number; lastReceivedAt: number | null; lastSlot: number | null }> {
  const sql = db();
  const [row] = await sql<{ n: number; last_ms: string | number | null; last_slot: string | number | null }[]>`
    select count(*)::int as n, (extract(epoch from max(received_at)) * 1000)::bigint as last_ms, max(slot) as last_slot from stream_deliveries`;
  return { deliveries: row.n, lastReceivedAt: row.last_ms === null ? null : Number(row.last_ms), lastSlot: row.last_slot === null ? null : Number(row.last_slot) };
}
