// Wallet sign-in. A person proves they hold a wallet by signing a short message (free, not a transaction).
// The server then sets a signed, httpOnly session cookie. No passwords, no accounts.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { sessionSecret } from "./config";

const CHALLENGE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 12 * 60 * 60_000;
export const SESSION_COOKIE = "pc_session";

const hmac = (data: string) => createHmac("sha256", sessionSecret()).update(data).digest("base64url");
const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function parseAddress(value: unknown): PublicKey | null {
  if (typeof value !== "string" || value.length < 32 || value.length > 44) return null;
  try { return new PublicKey(value); } catch { return null; }
}

/** The message a wallet signs. The last line is our own tag, so only messages we issued are accepted. */
export function makeChallenge(owner: string, now = Date.now()): { message: string; expiresAt: number } {
  const expiresAt = now + CHALLENGE_TTL_MS;
  const nonce = randomBytes(12).toString("base64url");
  const head = `Petty Cash sign-in\n\nWallet: ${owner}\nThis proves the wallet is yours. It is free and is not a transaction.\n\nNonce: ${nonce}\nExpires: ${expiresAt}`;
  return { message: `${head}\nTag: ${hmac(head)}`, expiresAt };
}

export function verifyChallenge(owner: string, message: string, signatureBase64: string, now = Date.now()): boolean {
  if (typeof message !== "string" || message.length > 600 || typeof signatureBase64 !== "string") return false;
  const i = message.lastIndexOf("\nTag: ");
  if (i < 0) return false;
  const head = message.slice(0, i), tag = message.slice(i + 6);
  if (!safeEqual(tag, hmac(head))) return false;
  if (!head.includes(`\nWallet: ${owner}\n`)) return false;
  const expires = Number(/\nExpires: (\d+)$/.exec(head)?.[1] ?? 0);
  if (!expires || expires < now) return false;
  const key = parseAddress(owner);
  if (!key) return false;
  let sig: Buffer;
  try { sig = Buffer.from(signatureBase64, "base64"); } catch { return false; }
  if (sig.length !== 64) return false;
  return nacl.sign.detached.verify(new TextEncoder().encode(message), sig, key.toBytes());
}

export function makeSession(owner: string, now = Date.now()): { value: string; maxAgeSecs: number } {
  const body = Buffer.from(JSON.stringify({ o: owner, e: now + SESSION_TTL_MS })).toString("base64url");
  return { value: `${body}.${hmac(`session:${body}`)}`, maxAgeSecs: Math.floor(SESSION_TTL_MS / 1000) };
}

export function readSession(cookieValue: string | undefined, now = Date.now()): string | null {
  if (!cookieValue) return null;
  const [body, tag] = cookieValue.split(".");
  if (!body || !tag || !safeEqual(tag, hmac(`session:${body}`))) return null;
  try {
    const { o, e } = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { o: string; e: number };
    return typeof o === "string" && typeof e === "number" && e > now && parseAddress(o) ? o : null;
  } catch { return null; }
}

export function sessionOwner(req: Request): string | null {
  const cookie = req.headers.get("cookie") ?? "";
  const m = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`).exec(cookie);
  return readSession(m?.[1]);
}

export const sessionCookie = (value: string, maxAgeSecs: number) =>
  `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSecs}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;

export const clientIp = (req: Request) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";

/** Refuses cross-site POSTs: the Origin header, when present, must be our own host. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host")); } catch { return false; }
}

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
export const fail = (error: string, status = 400) => json({ error }, status);
