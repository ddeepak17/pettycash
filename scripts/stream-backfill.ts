// Re-delivers a past block range through the QuickNode Stream, so receipts from a time when the Stream was paused
// can still be verified. Deliveries are idempotent (one row per transaction signature).
//
//   pnpm tsx scripts/stream-backfill.ts            finds the earliest purchase the Stream has not delivered and starts there
//   pnpm tsx scripts/stream-backfill.ts <slot>     starts at that slot
//
// The Stream then keeps running from that slot to the tip. Pause it afterwards (pnpm tsx scripts/stream.ts pause),
// or let the app pause it when idle. Billing is per processed block.
import { existsSync } from "node:fs";
import postgres from "postgres";
import { Connection } from "@solana/web3.js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

async function main() {
  const { activateAtTip, fetchStream, mainnetTip } = await import("../src/lib/stream/control");
  const apiKey = process.env.QUICKNODE_API_KEY, id = process.env.QN_STREAM_ID;
  if (!apiKey || !id) throw new Error("QUICKNODE_API_KEY and QN_STREAM_ID are required");
  let from = Number(process.argv[2] ?? 0);
  if (!from) {
    const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
    const rows = await sql`select p.pull_sig from pettycash.purchases p where p.cluster = 'mainnet-beta' and p.pull_sig is not null
      and not exists (select 1 from pettycash.stream_deliveries d where d.signature = p.pull_sig) order by p.created_at asc limit 1`;
    await sql.end();
    if (!rows.length) { console.log("Every pull is already delivered. Nothing to backfill."); return; }
    const c = new Connection((process.env.RPC_URLS ?? "https://api.mainnet-beta.solana.com").split(",")[0], "confirmed");
    const st = (await c.getSignatureStatuses([rows[0].pull_sig as string], { searchTransactionHistory: true })).value[0];
    if (!st) throw new Error("could not find the slot of the earliest undelivered pull");
    from = st.slot - 2;
  }
  const tip = await mainnetTip();
  const stream = await fetchStream(apiKey, id);
  const r = await activateAtTip(apiKey, stream, from);
  console.log(JSON.stringify({ backfillFrom: from, tip, blocks: tip - from, estimatedCredits: (tip - from) * 30, status: r.status }));
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
