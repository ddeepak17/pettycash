// The webhook handler with the database replaced by an in-memory fake, so the order of decisions is visible.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signQuickNode } from "../../src/lib/stream/verify";

const db = vi.hoisted(() => ({
  nonces: new Set<string>(),
  rows: new Map<string, unknown>(),
  calls: 0,
  failNext: false,
}));

vi.mock("../../src/lib/stream/store", () => ({
  toDeliveryRows: (matches: { signature: string; slot: number; blockTime: number | null; ok: boolean }[], streamId: string | null) =>
    matches.map((m) => ({ signature: m.signature, slot: m.slot, blockTime: m.blockTime, ok: m.ok, payload: m, streamId })),
  recordDelivery: async (nonce: string, rows: { signature: string }[]) => {
    db.calls++;
    if (db.failNext) { db.failNext = false; throw new Error("connection lost to db.example:6543"); }
    if (db.nonces.has(nonce)) return { fresh: false, saved: 0 };
    db.nonces.add(nonce);
    let saved = 0;
    for (const r of rows) if (!db.rows.has(r.signature)) { db.rows.set(r.signature, r); saved++; }
    return { fresh: true, saved };
  },
  deliveryStats: async () => ({ deliveries: db.rows.size, lastReceivedAt: db.rows.size ? 1_795_163_482_000 : null, lastSlot: db.rows.size ? 471671101 : null }),
}));

import { GET, POST } from "../../src/app/api/quicknode/route";

const TOKEN = "c".repeat(64);
const AGENT = "5SAtLdgB7VnhbTBJGjKs4HkYKNjPC4Dnhx6FLVu4Jtz9";
const SELLER = "7r4e5dwNS68MDaxbw7N8jbzHq7RCMBp9z6smHFH4NXWw";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SIG = "2G38it8REW3Uvh6piEFL1P4jGCZXPC1tQ8F6jDhiwPGj7x16h8QBDw3yymDRNye1BSioVjyFEZkrUajSkdjcjAnH";
const match = (signature = SIG) => ({ signature, slot: 471671101, blockTime: 1795163481, ok: true, err: null, feePayer: SELLER, version: 0, programs: [], allowances: false, allowanceIxs: [], memos: [], movements: [{ owner: AGENT, mint: USDC, deltaBase: "-1000" }, { owner: SELLER, mint: USDC, deltaBase: "1000" }] });
const envelope = (...matches: unknown[]) => JSON.stringify({ pettycash: 1, agent: AGENT, network: "solana-mainnet", streamId: "stream-1", matches });

function request(body: string, opts: { token?: string; nonce?: string | null; timestamp?: string; signature?: string | null } = {}) {
  const nonce = opts.nonce === undefined ? `nonce-${Math.random()}` : opts.nonce;
  const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = { "content-type": "application/json", "x-qn-timestamp": timestamp };
  if (nonce !== null) headers["x-qn-nonce"] = nonce;
  const signature = opts.signature === undefined ? signQuickNode(opts.token ?? TOKEN, nonce ?? "", timestamp, body) : opts.signature;
  if (signature !== null) headers["x-qn-signature"] = signature;
  return new Request("https://pettycash.example/api/quicknode", { method: "POST", headers, body });
}

beforeEach(() => {
  db.nonces.clear();
  db.rows.clear();
  db.calls = 0;
  db.failNext = false;
  process.env.QN_STREAM_SECURITY_TOKEN = TOKEN;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/quicknode", () => {
  it("stores an authenticated delivery and answers 200", async () => {
    const res = await POST(request(envelope(match())));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, matches: 1, saved: 1, skipped: 0 });
    expect(db.rows.get(SIG)).toMatchObject({ signature: SIG, slot: 471671101, blockTime: 1795163481, ok: true, streamId: "stream-1" });
  });

  it("answers 401 and never touches the database for unauthenticated requests", async () => {
    const body = envelope(match());
    const attempts = [
      request(body, { signature: null }),
      request(body, { nonce: null }),
      request(body, { signature: "0".repeat(64) }),
      request(body, { signature: "not-hex" }),
      request(body, { token: "d".repeat(64) }),
      request(body, { timestamp: String(Math.floor(Date.now() / 1000) - 6 * 60) }),
      request(body, { timestamp: String(Math.floor(Date.now() / 1000) + 6 * 60) }),
    ];
    for (const req of attempts) {
      const res = await POST(req);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
    }
    expect(db.calls).toBe(0);
    expect(db.rows.size).toBe(0);
  });

  it("rejects a body that was changed after signing", async () => {
    const signed = envelope(match());
    const nonce = "n-1";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const res = await POST(request(signed.replace('"-1000"', '"-9999"'), { nonce, timestamp, signature: signQuickNode(TOKEN, nonce, timestamp, signed) }));
    expect(res.status).toBe(401);
    expect(db.calls).toBe(0);
  });

  it("answers 503 when the security token is not configured, whatever is sent", async () => {
    delete process.env.QN_STREAM_SECURITY_TOKEN;
    const res = await POST(request(envelope(match()), { token: "" }));
    expect(res.status).toBe(503);
    expect(db.calls).toBe(0);
  });

  it("acknowledges a replayed nonce without storing again", async () => {
    const first = await POST(request(envelope(match()), { nonce: "same" }));
    expect(first.status).toBe(200);
    const replay = await POST(request(envelope(match(SIG.replace(/^2G/, "3H"))), { nonce: "same" }));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ ok: true, duplicate: true });
    expect(db.rows.size).toBe(1);
  });

  it("is idempotent: the same transaction delivered twice is stored once", async () => {
    await POST(request(envelope(match())));
    const again = await POST(request(envelope(match())));
    expect(await again.json()).toEqual({ ok: true, matches: 1, saved: 0, skipped: 0 });
    expect(db.rows.size).toBe(1);
  });

  it("answers 500 when the database fails, without consuming the nonce, so the retry is stored", async () => {
    db.failNext = true;
    const body = envelope(match());
    const failed = await POST(request(body, { nonce: "retry-me" }));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ ok: false, error: "store error" });
    expect(db.rows.size).toBe(0);
    const retried = await POST(request(body, { nonce: "retry-me" }));
    expect(await retried.json()).toEqual({ ok: true, matches: 1, saved: 1, skipped: 0 });
  });

  it("does not leak database details in the response or the log", async () => {
    db.failNext = true;
    const res = await POST(request(envelope(match())));
    expect(JSON.stringify(await res.json())).not.toContain("db.example");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("db.example");
  });

  it("accepts the other shapes a delivery can take", async () => {
    const a = SIG.replace(/^2G/, "3A"), b = SIG.replace(/^2G/, "3B"), c = SIG.replace(/^2G/, "3C");
    expect(await (await POST(request(JSON.stringify(match(a))))).json()).toMatchObject({ matches: 1, saved: 1 });
    expect(await (await POST(request(JSON.stringify([match(b)])))).json()).toMatchObject({ matches: 1, saved: 1 });
    expect(await (await POST(request(JSON.stringify({ data: [{ matches: [match(c)] }], metadata: { stream_id: "from-metadata" } })))).json()).toMatchObject({ matches: 1, saved: 1 });
    expect(db.rows.get(c)).toMatchObject({ streamId: "from-metadata" });
  });

  it("stores the good entries and skips malformed ones, still answering 200", async () => {
    const res = await POST(request(envelope(match(), { ...match(SIG.replace(/^2G/, "3H")), movements: [{ owner: AGENT, mint: USDC, deltaBase: 12 }] })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, matches: 1, saved: 1, skipped: 1 });
    expect([...db.rows.keys()]).toEqual([SIG]);
  });

  it("answers 200 and stores nothing for an authenticated body that is not JSON or holds no transactions", async () => {
    const notJson = await POST(request("hello"));
    expect(notJson.status).toBe(200);
    expect(await notJson.json()).toMatchObject({ ok: true, matches: 0, saved: 0 });
    const empty = await POST(request(JSON.stringify({ message: "test" })));
    expect(await empty.json()).toEqual({ ok: true, matches: 0, saved: 0, skipped: 0 });
    expect(db.rows.size).toBe(0);
  });
});

describe("GET /api/quicknode", () => {
  it("reports health without any secret", async () => {
    process.env.QUICKNODE_API_KEY = "QN_secret_key_value";
    process.env.QN_STREAM_ID = "11111111-2222-3333-4444-555555555555";
    await POST(request(envelope(match())));
    const res = await GET();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, webhook: "quicknode-streams", tokenConfigured: true, streamConfigured: true, database: "ok", deliveries: 1, lastReceivedAt: new Date(1_795_163_482_000).toISOString(), lastSlot: 471671101 });
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("QN_secret_key_value");
    expect(text).not.toContain("11111111-2222");
    delete process.env.QUICKNODE_API_KEY;
    delete process.env.QN_STREAM_ID;
  });
});
