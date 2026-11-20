// Housekeeping, called on a timer: return money from purchases that did not complete, and pause the Stream
// when no errand has needed it for a while. Requires the shared secret.
import { timingSafeEqual } from "node:crypto";
import { settleUnresolved } from "@/lib/agent/purchase";
import { fail, json } from "@/lib/server/auth";
import { restStreamIfIdle } from "@/lib/server/streamHooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  const a = Buffer.from(given), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return fail("Not authorised.", 401);
  const settled = await settleUnresolved().catch(() => null);
  const stream = await restStreamIfIdle();
  return json({ ok: true, settled, stream });
}
