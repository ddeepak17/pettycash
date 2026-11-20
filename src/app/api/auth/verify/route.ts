import { fail, json, makeSession, parseAddress, requestHost, sameOrigin, sessionCookie, verifyChallenge } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail("Cross-site request refused.", 403);
  const body = (await req.json().catch(() => ({}))) as { owner?: unknown; message?: unknown; signature?: unknown };
  const owner = parseAddress(body.owner);
  if (!owner || typeof body.message !== "string" || typeof body.signature !== "string") return fail("Missing wallet, message or signature.");
  if (!verifyChallenge(owner.toBase58(), requestHost(req), body.message, body.signature)) return fail("The signature did not match this wallet, or the sign-in request expired. Try again.", 401);
  const session = makeSession(owner.toBase58());
  return json({ owner: owner.toBase58() }, 200, { "set-cookie": sessionCookie(session.value, session.maxAgeSecs) });
}
