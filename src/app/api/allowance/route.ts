import { clientIp, fail, json, parseAddress } from "@/lib/server/auth";
import { withinRateLimit } from "@/lib/server/store";
import { readAllowanceState } from "@/lib/server/agentWallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cache = new Map<string, { at: number; body: unknown }>();

/** Everything here is public chain state: balances and the wallet's petty cashes for this agent. */
export async function GET(req: Request) {
  const owner = parseAddress(new URL(req.url).searchParams.get("owner"));
  if (!owner) return fail("That is not a valid wallet address.");
  if (!(await withinRateLimit(`allowance:${clientIp(req)}`, 90, 60).catch(() => false))) return fail("Too many requests. Slow down for a minute.", 429);
  try {
    // The same wallet's state serves repeated requests for a few seconds, so this cannot be turned into a stream of chain scans.
    const key = owner.toBase58();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 2500) return json(hit.body);
    const body = await readAllowanceState(owner);
    cache.set(key, { at: Date.now(), body });
    if (cache.size > 500) cache.clear();
    return json(body);
  } catch {
    return fail("Solana could not be reached just now. Try again in a moment.", 503);
  }
}
