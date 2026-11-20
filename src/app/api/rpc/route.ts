// Same-origin JSON-RPC proxy for the browser. Public Solana RPC endpoints refuse many browser origins, and a
// provider URL with a key must not be shipped to the browser. Only the methods the app needs are allowed.
import { clientIp, fail, json } from "@/lib/server/auth";
import { rpcUrls } from "@/lib/server/config";
import { withinRateLimit } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set([
  "getLatestBlockhash", "sendTransaction", "getSignatureStatuses", "getAccountInfo", "getBalance", "getTokenAccountBalance", "simulateTransaction",
  "getMinimumBalanceForRentExemption", "getBlockHeight", "getSlot", "getFeeForMessage", "getGenesisHash", "getVersion", "getEpochInfo", "isBlockhashValid",
]);
type Call = { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown };

async function forward(body: string, broadcast: boolean): Promise<Response | null> {
  const urls = rpcUrls();
  const call = (url: string) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(15_000) });
  if (broadcast) {
    // A signed transaction goes to every endpoint; the first good answer is returned.
    const results = await Promise.allSettled(urls.map(call));
    for (const r of results) if (r.status === "fulfilled" && r.value.ok) return r.value;
    return null;
  }
  for (const url of urls) {
    try { const res = await call(url); if (res.ok) return res; } catch { /* next endpoint */ }
  }
  return null;
}

export async function POST(req: Request) {
  const text = await req.text();
  if (text.length > 20_000) return fail("Request too large.", 413);
  let parsed: Call | Call[];
  try { parsed = JSON.parse(text); } catch { return fail("Invalid JSON."); }
  const calls = Array.isArray(parsed) ? parsed : [parsed];
  if (calls.length === 0 || calls.length > 10) return fail("Too many calls in one request.");
  for (const c of calls) if (typeof c.method !== "string" || !ALLOWED.has(c.method)) return fail(`Method not allowed: ${String(c.method).slice(0, 40)}`, 403);
  // Every call in a batch counts. One caller gets 180 calls a minute; everyone together gets 3000.
  for (let i = 0; i < calls.length; i++) {
    if (!(await withinRateLimit(`rpc:${clientIp(req)}`, 180, 60).catch(() => false)) || !(await withinRateLimit("rpc:all", 3000, 60).catch(() => false)))
      return fail("Too many requests. Slow down for a minute.", 429);
  }
  const res = await forward(text, calls.some((c) => c.method === "sendTransaction"));
  if (!res) return json({ jsonrpc: "2.0", id: Array.isArray(parsed) ? null : (parsed.id ?? null), error: { code: -32000, message: "Solana could not be reached just now." } }, 502);
  return new Response(await res.text(), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
