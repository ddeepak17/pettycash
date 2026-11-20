// "Test the limit": asks the chain to pull one base unit more than a petty cash has left. The Allowances
// program refuses. With send=true the refusal is recorded onchain as a failed transaction anyone can open.
import { clientIp, fail, json, parseAddress, sameOrigin, sessionOwner } from "@/lib/server/auth";
import { proveOverspend, readAllowance } from "@/lib/server/agentWallet";
import { agentPublicKey, house } from "@/lib/server/config";
import { withinRateLimit } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail("Cross-site request refused.", 403);
  const body = (await req.json().catch(() => ({}))) as { delegation?: unknown; send?: unknown };
  const address = parseAddress(body.delegation);
  if (!address) return fail("That is not a valid petty cash address.");
  const send = body.send === true;
  const ip = clientIp(req);
  // A sent proof costs the agent a network fee, so it is limited harder than a simulation.
  if (!(await withinRateLimit(`prove:${send ? "send" : "sim"}:${ip}`, send ? 6 : 30, 3600)) || (send && !(await withinRateLimit("prove:send:all", 60, 3600))))
    return fail("That is enough limit tests for now. Try again later.", 429);
  try {
    const live = await readAllowance(address);
    if (live && !live.view.delegatee.equals(agentPublicKey())) return fail("That petty cash belongs to a different agent.");
    // Recording the refusal onchain is offered for your own petty cash and for the public demo one, not for a stranger's.
    const isHouse = house()?.delegation.equals(address) === true;
    if (send && live && !isHouse && sessionOwner(req) !== live.view.delegator.toBase58()) return fail("Sign in with the wallet that owns this petty cash to record the test onchain.", 401);
    return json(await proveOverspend(address, send));
  } catch (e) {
    return fail(e instanceof Error && e.message.startsWith("The limit test") ? e.message : "Solana could not be reached just now. Try again in a moment.", 503);
  }
}
