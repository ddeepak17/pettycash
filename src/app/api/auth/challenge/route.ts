import { clientIp, fail, json, makeChallenge, parseAddress, requestHost, sameOrigin } from "@/lib/server/auth";
import { withinRateLimit } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail("Cross-site request refused.", 403);
  const body = (await req.json().catch(() => ({}))) as { owner?: unknown };
  const owner = parseAddress(body.owner);
  if (!owner) return fail("That is not a valid wallet address.");
  if (!(await withinRateLimit(`auth:${clientIp(req)}`, 30, 600).catch(() => false))) return fail("Too many sign-in attempts. Try again in a few minutes.", 429);
  return json(makeChallenge(owner.toBase58(), requestHost(req)));
}
