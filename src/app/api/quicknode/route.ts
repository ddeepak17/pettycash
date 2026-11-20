// QuickNode Streams webhook: the independent record of what the agent's transactions really did.
//
// POST: raw body -> authenticate (HMAC, fresh timestamp) -> replay guard -> parse the filter's output -> store.
// Unauthenticated requests get 401 and never reach the database.
// GET: a small health status. No secrets, no URLs.
import { parseStreamBody } from "../../../lib/stream/match";
import { deliveryStats, recordDelivery, toDeliveryRows } from "../../../lib/stream/store";
import { authenticateWebhook } from "../../../lib/stream/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bodies are the filter's compact output (a few hundred bytes per transaction); anything huge is not ours. */
const MAX_BODY_BYTES = 2_000_000;

const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: Request): Promise<Response> {
  const token = process.env.QN_STREAM_SECURITY_TOKEN;
  if (!token) return json(503, { ok: false, error: "not configured" });

  const raw = Buffer.from(await req.arrayBuffer());
  if (raw.length > MAX_BODY_BYTES) return json(413, { ok: false, error: "body too large" });
  const nonce = req.headers.get("x-qn-nonce");
  const auth = authenticateWebhook({
    token,
    nonce,
    timestamp: req.headers.get("x-qn-timestamp"),
    signature: req.headers.get("x-qn-signature"),
    body: raw,
  });
  if (!auth.ok || !nonce) return json(401, { ok: false, error: "unauthorized" });

  // From here on the request is QuickNode's. Anything other than a database failure is answered with 200:
  // QuickNode retries and then stops a stream that keeps getting errors, and a retry cannot fix a bad payload.
  let body: unknown;
  try { body = JSON.parse(raw.toString("utf8")); } catch {
    console.warn("[quicknode] authenticated delivery was not JSON; nothing stored");
    return json(200, { ok: true, matches: 0, saved: 0, skipped: 0, note: "not json" });
  }
  const parsed = parseStreamBody(body);
  if (parsed.skipped > 0) console.warn(`[quicknode] ${parsed.skipped} malformed transaction entr${parsed.skipped === 1 ? "y" : "ies"} ignored`);
  const streamId = parsed.streamId ?? req.headers.get("stream-id");

  try {
    // One statement claims the nonce and stores the rows, so a failure consumes neither and the retry is processed.
    const result = await recordDelivery(nonce, toDeliveryRows(parsed.matches, streamId));
    if (!result.fresh) return json(200, { ok: true, duplicate: true });
    return json(200, { ok: true, matches: parsed.matches.length, saved: result.saved, skipped: parsed.skipped });
  } catch (e) {
    // Only the error class or code is logged: driver messages can carry connection details.
    console.error("[quicknode] could not store the delivery:", (e as { code?: string })?.code ?? (e instanceof Error ? e.name : "unknown error"));
    return json(500, { ok: false, error: "store error" });
  }
}

export async function GET(): Promise<Response> {
  const status: Record<string, unknown> = {
    ok: true,
    webhook: "quicknode-streams",
    tokenConfigured: !!process.env.QN_STREAM_SECURITY_TOKEN,
    streamConfigured: !!process.env.QUICKNODE_API_KEY && !!process.env.QN_STREAM_ID,
    database: "unknown",
  };
  try {
    const stats = await deliveryStats();
    status.database = "ok";
    status.deliveries = stats.deliveries;
    status.lastReceivedAt = stats.lastReceivedAt === null ? null : new Date(stats.lastReceivedAt).toISOString();
    status.lastSlot = stats.lastSlot;
  } catch {
    status.ok = false;
    status.database = "unreachable";
  }
  return json(status.ok ? 200 : 503, status);
}
