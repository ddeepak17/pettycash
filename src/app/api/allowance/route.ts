import { fail, json, parseAddress } from "@/lib/server/auth";
import { readAllowanceState } from "@/lib/server/agentWallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Everything here is public chain state: balances and the wallet's petty cashes for this agent. */
export async function GET(req: Request) {
  const owner = parseAddress(new URL(req.url).searchParams.get("owner"));
  if (!owner) return fail("That is not a valid wallet address.");
  try {
    return json(await readAllowanceState(owner));
  } catch {
    return fail("Solana could not be reached just now. Try again in a moment.", 503);
  }
}
