import { fail, json, sameOrigin, sessionCookie } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail("Cross-site request refused.", 403);
  return json({ owner: null }, 200, { "set-cookie": sessionCookie("", 0) });
}
