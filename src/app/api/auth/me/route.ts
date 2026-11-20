import { json, sessionOwner } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return json({ owner: sessionOwner(req) });
}
