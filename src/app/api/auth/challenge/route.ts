import { fail, json, makeChallenge, parseAddress, sameOrigin } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail("Cross-site request refused.", 403);
  const body = (await req.json().catch(() => ({}))) as { owner?: unknown };
  const owner = parseAddress(body.owner);
  if (!owner) return fail("That is not a valid wallet address.");
  return json(makeChallenge(owner.toBase58()));
}
