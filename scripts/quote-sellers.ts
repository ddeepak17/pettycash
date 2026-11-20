// Asks every seller in the catalog for its price right now. Unpaid: nothing is signed and nothing is spent.
//   pnpm tsx scripts/quote-sellers.ts
import { SELLERS, REASONING_SELLER } from "../src/lib/agent/catalog";
import { getQuote } from "../src/lib/x402/client";
import { CLUSTERS } from "../src/lib/solana/cluster";

const want = { network: CLUSTERS["mainnet-beta"].network, asset: CLUSTERS["mainnet-beta"].usdcMint };

async function main() {
  const rows: Record<string, unknown>[] = [];
  const sample: Record<string, Record<string, string>> = {};
  for (const s of SELLERS) sample[s.id] = Object.fromEntries(s.params.map((p) => [p.name, p.example]));
  const jobs = SELLERS.map(async (s) => {
    const started = Date.now();
    const r = await getQuote(s.build(sample[s.id]), want);
    rows.push({
      id: s.id, seller: s.name, host: s.host, result: r.kind,
      price: r.kind === "quote" ? r.quote.offer.amount : null,
      payToMatchesPin: r.kind === "quote" ? r.quote.offer.payTo === s.payTo : null,
      feePayer: r.kind === "quote" ? String(r.quote.offer.extra?.feePayer ?? "") : null,
      version: r.kind === "quote" ? r.quote.x402Version : null,
      error: r.kind === "error" ? r.error : null, ms: Date.now() - started,
    });
  });
  jobs.push((async () => {
    const started = Date.now();
    const r = await getQuote({ method: "POST", url: REASONING_SELLER.url, body: JSON.stringify({ model: "google/gemini-3-flash-preview", messages: [{ role: "user", content: "Reply with exactly: OK" }], max_tokens: 16 }) }, want);
    rows.push({ id: "reasoning", seller: REASONING_SELLER.name, host: REASONING_SELLER.host, result: r.kind, price: r.kind === "quote" ? r.quote.offer.amount : null,
      payToMatchesPin: r.kind === "quote" ? r.quote.offer.payTo === REASONING_SELLER.payTo : null, feePayer: r.kind === "quote" ? String(r.quote.offer.extra?.feePayer ?? "") : null,
      version: r.kind === "quote" ? r.quote.x402Version : null, error: r.kind === "error" ? r.error : null, ms: Date.now() - started });
  })());
  await Promise.all(jobs);
  rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  console.table(rows);
  console.log(JSON.stringify({ at: new Date().toISOString(), quoted: rows.filter((r) => r.result === "quote").length, total: rows.length }));
}
main().catch((e) => { console.error(e); process.exit(1); });
