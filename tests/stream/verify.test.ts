import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { QN_TOLERANCE_MS, authenticateWebhook, signQuickNode, timestampFresh, verifyQuickNodeSignature } from "../../src/lib/stream/verify";

const TOKEN = "a".repeat(64);
const NONCE = "5f1d7c2e-nonce";
const NOW = 1_795_163_500_000;
const TS = String(NOW / 1000);
const BODY = JSON.stringify({ pettycash: 1, matches: [{ signature: "x" }] });

describe("QuickNode webhook signature", () => {
  it("is hex(HMAC-SHA256(token, nonce + timestamp + body))", () => {
    const expected = createHmac("sha256", TOKEN).update(NONCE + TS + BODY).digest("hex");
    expect(signQuickNode(TOKEN, NONCE, TS, BODY)).toBe(expected);
    expect(verifyQuickNodeSignature(TOKEN, NONCE, TS, BODY, expected)).toBe(true);
    expect(verifyQuickNodeSignature(TOKEN, NONCE, TS, BODY, expected.toUpperCase())).toBe(true);
  });

  it("signs the body bytes as received", () => {
    const bytes = Buffer.from('{"memo":"café €1"}', "utf8");
    const sig = signQuickNode(TOKEN, NONCE, TS, bytes);
    expect(verifyQuickNodeSignature(TOKEN, NONCE, TS, bytes, sig)).toBe(true);
    expect(verifyQuickNodeSignature(TOKEN, NONCE, TS, bytes.toString("utf8"), sig)).toBe(true);
  });

  it("rejects any change to the token, nonce, timestamp or body", () => {
    const sig = signQuickNode(TOKEN, NONCE, TS, BODY);
    expect(verifyQuickNodeSignature("b".repeat(64), NONCE, TS, BODY, sig)).toBe(false);
    expect(verifyQuickNodeSignature(TOKEN, `${NONCE}x`, TS, BODY, sig)).toBe(false);
    expect(verifyQuickNodeSignature(TOKEN, NONCE, String(Number(TS) + 1), BODY, sig)).toBe(false);
    expect(verifyQuickNodeSignature(TOKEN, NONCE, TS, `${BODY} `, sig)).toBe(false);
  });

  it("returns false, never throws, for malformed signatures or an empty token", () => {
    for (const bad of ["", "zz", "abc", "g".repeat(64), "a".repeat(63), "a".repeat(65), `sha256=${"a".repeat(64)}`]) {
      expect(verifyQuickNodeSignature(TOKEN, NONCE, TS, BODY, bad)).toBe(false);
    }
    expect(verifyQuickNodeSignature("", NONCE, TS, BODY, signQuickNode("", NONCE, TS, BODY))).toBe(false);
  });
});

describe("timestamp freshness", () => {
  it("accepts seconds or milliseconds within 5 minutes either way", () => {
    expect(timestampFresh(TS, NOW)).toBe(true);
    expect(timestampFresh(String(NOW), NOW)).toBe(true);
    expect(timestampFresh(String((NOW - QN_TOLERANCE_MS) / 1000), NOW)).toBe(true);
    expect(timestampFresh(String((NOW + QN_TOLERANCE_MS) / 1000), NOW)).toBe(true);
  });

  it("rejects anything older or newer than 5 minutes, and anything that is not a number", () => {
    expect(timestampFresh(String((NOW - QN_TOLERANCE_MS - 1000) / 1000), NOW)).toBe(false);
    expect(timestampFresh(String((NOW + QN_TOLERANCE_MS + 1000) / 1000), NOW)).toBe(false);
    for (const bad of ["", "0", "-5", "abc", "1.5e9", "1795163500.5", " 1795163500", "2026-11-20T00:00:00Z"]) expect(timestampFresh(bad, NOW)).toBe(false);
  });
});

describe("authenticateWebhook", () => {
  const good = () => ({ token: TOKEN, nonce: NONCE, timestamp: TS, signature: signQuickNode(TOKEN, NONCE, TS, BODY), body: BODY, nowMs: NOW });

  it("accepts a correctly signed, fresh delivery", () => {
    expect(authenticateWebhook(good())).toEqual({ ok: true });
  });

  it("refuses when the token is not configured", () => {
    expect(authenticateWebhook({ ...good(), token: undefined })).toEqual({ ok: false, reason: "not_configured" });
    expect(authenticateWebhook({ ...good(), token: "" })).toEqual({ ok: false, reason: "not_configured" });
  });

  it("refuses when a header is missing", () => {
    expect(authenticateWebhook({ ...good(), nonce: null })).toEqual({ ok: false, reason: "missing_headers" });
    expect(authenticateWebhook({ ...good(), timestamp: null })).toEqual({ ok: false, reason: "missing_headers" });
    expect(authenticateWebhook({ ...good(), signature: "" })).toEqual({ ok: false, reason: "missing_headers" });
  });

  it("refuses a wrong signature and a tampered body", () => {
    expect(authenticateWebhook({ ...good(), signature: "0".repeat(64) })).toEqual({ ok: false, reason: "bad_signature" });
    expect(authenticateWebhook({ ...good(), body: BODY.replace("x", "y") })).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a correctly signed delivery that is too old (a replay)", () => {
    expect(authenticateWebhook({ ...good(), nowMs: NOW + QN_TOLERANCE_MS + 1000 })).toEqual({ ok: false, reason: "stale_timestamp" });
  });
});
