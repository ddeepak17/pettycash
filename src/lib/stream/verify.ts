// QuickNode Streams webhook authentication. Pure functions: no environment, no database.
//
//   x-qn-signature = hex( HMAC-SHA256( security_token, x-qn-nonce + x-qn-timestamp + rawBody ) )
//
// The body must be the bytes exactly as received; re-serialised JSON will not match.
import { createHmac, timingSafeEqual } from "node:crypto";

/** A delivery is accepted only when its timestamp is within this distance of our clock. */
export const QN_TOLERANCE_MS = 5 * 60_000;

type Body = string | Uint8Array;

function hmac(token: string, nonce: string, timestamp: string, body: Body): Buffer {
  const mac = createHmac("sha256", Buffer.from(token, "utf8"));
  mac.update(Buffer.from(nonce + timestamp, "utf8"));
  mac.update(typeof body === "string" ? Buffer.from(body, "utf8") : body);
  return mac.digest();
}

/** The signature QuickNode would send for this delivery (used by tests and local tooling). */
export function signQuickNode(token: string, nonce: string, timestamp: string, body: Body): string {
  return hmac(token, nonce, timestamp, body).toString("hex");
}

/** Timing-safe check of x-qn-signature. Malformed or wrong-length signatures are false, never an exception. */
export function verifyQuickNodeSignature(token: string, nonce: string, timestamp: string, body: Body, signature: string): boolean {
  if (!token || !/^[0-9a-fA-F]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature, "hex"), hmac(token, nonce, timestamp, body));
}

/** x-qn-timestamp is unix time (seconds; milliseconds are accepted too). False when more than 5 minutes from `nowMs`. */
export function timestampFresh(timestamp: string, nowMs: number = Date.now()): boolean {
  if (!/^\d{1,16}$/.test(timestamp)) return false;
  const n = Number(timestamp);
  if (!Number.isFinite(n) || n <= 0) return false;
  const ms = n > 1e12 ? n : n * 1000;
  return Math.abs(nowMs - ms) <= QN_TOLERANCE_MS;
}

export type WebhookAuth = { ok: true } | { ok: false; reason: "not_configured" | "missing_headers" | "bad_signature" | "stale_timestamp" };

/** The whole decision for one request: all three headers present, signature correct, timestamp fresh. */
export function authenticateWebhook(input: {
  token: string | undefined;
  nonce: string | null;
  timestamp: string | null;
  signature: string | null;
  body: Body;
  nowMs?: number;
}): WebhookAuth {
  if (!input.token) return { ok: false, reason: "not_configured" };
  if (!input.nonce || !input.timestamp || !input.signature) return { ok: false, reason: "missing_headers" };
  if (!verifyQuickNodeSignature(input.token, input.nonce, input.timestamp, input.body, input.signature)) return { ok: false, reason: "bad_signature" };
  if (!timestampFresh(input.timestamp, input.nowMs)) return { ok: false, reason: "stale_timestamp" };
  return { ok: true };
}
