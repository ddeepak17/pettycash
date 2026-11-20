// Stream control with QuickNode, the RPC and the settings table replaced by fakes. What matters here is the ORDER
// of calls (start_range moves to the tip before activation) and that no other stream can ever be changed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ value: null as null | { at: string }, writes: 0, onRead: null as null | (() => void) }));
vi.mock("../../src/lib/stream/store", () => ({
  getSetting: async () => {
    const row = settings.value ? { value: settings.value, updatedAt: Date.parse(settings.value.at) } : null;
    settings.onRead?.();
    return row;
  },
  setSetting: async (_key: string, value: { at: string }) => { settings.value = value; settings.writes++; },
}));

import { LAST_NEEDED_KEY, STREAM_NAME, ensureStreamActive, mainnetTip, pauseStreamIfIdle, qnError, streamStatus, summarize } from "../../src/lib/stream/control";

const ID = "11111111-2222-3333-4444-555555555555";
const KEY = "QN_test_api_key";
const TIP = 471_700_000;
const GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

type Call = { method: string; url: string; body: unknown };
let calls: Call[] = [];
let stream: Record<string, unknown>;
let rpc: { genesis: string; slot: number | null; fail: boolean };
let patchStatus = 200;

const qnCalls = () => calls.filter((c) => c.url.includes("api.quicknode.com")).map((c) => `${c.method} ${c.url.split("/rest/v1")[1]}${c.body ? ` ${JSON.stringify(c.body)}` : ""}`);
const changes = () => qnCalls().filter((c) => !c.startsWith("GET"));

beforeEach(() => {
  calls = [];
  patchStatus = 200;
  settings.value = null;
  settings.writes = 0;
  settings.onRead = null;
  stream = { id: ID, name: STREAM_NAME, network: "solana-mainnet", dataset: "block", status: "paused", start_range: 100, end_range: -1, region: "usa_east", dataset_batch_size: 5,
    destination_attributes: { url: "https://secret.example/hook", security_token: "tok_secret" }, filter_function: "c2VjcmV0" };
  rpc = { genesis: GENESIS, slot: TIP, fail: false };
  process.env.QUICKNODE_API_KEY = KEY;
  process.env.QN_STREAM_ID = ID;
  delete process.env.STREAM_TIP_RPC_URL;
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const reply = (status: number, json: unknown) => new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
    if (!url.includes("api.quicknode.com")) {
      if (rpc.fail) return reply(429, { error: "rate limited" });
      return reply(200, { jsonrpc: "2.0", id: 1, result: body.method === "getGenesisHash" ? rpc.genesis : rpc.slot });
    }
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(KEY);
    if (!url.endsWith(`/streams/${ID}`) && !url.endsWith(`/streams/${ID}/activate`) && !url.endsWith(`/streams/${ID}/pause`)) return reply(404, { message: "not found" });
    if (method === "GET") return reply(200, stream);
    if (method === "PATCH") {
      if (patchStatus >= 300) return reply(patchStatus, { message: "start_range rejected" });
      Object.assign(stream, body);
      return reply(200, stream);
    }
    if (url.endsWith("/activate")) { stream.status = "active"; return reply(200, stream); }
    if (url.endsWith("/pause")) { stream.status = "paused"; return reply(200, stream); }
    return reply(405, {});
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("ensureStreamActive", () => {
  it("moves start_range to the mainnet tip, THEN activates, and records that the stream was needed", async () => {
    const before = Date.now();
    const r = await ensureStreamActive();
    expect(r).toEqual({ active: true, activated: true, status: "active", startRange: TIP });
    expect(changes()).toEqual([`PATCH /streams/${ID} {"start_range":${TIP}}`, `POST /streams/${ID}/activate`]);
    expect(stream.start_range).toBe(TIP);
    expect(Date.parse(settings.value!.at)).toBeGreaterThanOrEqual(before);
    expect(LAST_NEEDED_KEY).toBe("stream_last_needed");
  });

  it("changes nothing when the stream is already active, but still records the need", async () => {
    stream.status = "active";
    expect(await ensureStreamActive()).toMatchObject({ active: true, activated: false });
    expect(changes()).toEqual([]);
    expect(settings.writes).toBe(1);
  });

  it("re-activates a stream QuickNode stopped on its own (terminated)", async () => {
    stream.status = "terminated";
    expect((await ensureStreamActive()).activated).toBe(true);
    expect(stream.status).toBe("active");
  });

  it("never activates without the tip: no replay of old blocks", async () => {
    rpc.fail = true;
    await expect(ensureStreamActive()).rejects.toThrow("could not read the current mainnet slot");
    expect(changes()).toEqual([]);
    expect(stream.status).toBe("paused");
  });

  it("never activates when start_range could not be moved", async () => {
    patchStatus = 422;
    await expect(ensureStreamActive()).rejects.toThrow(/not activating/);
    expect(changes()).toEqual([`PATCH /streams/${ID} {"start_range":${TIP}}`]);
    expect(stream.status).toBe("paused");
  });

  it("refuses a tip from an RPC that is not mainnet (a devnet slot would park the stream in the future)", async () => {
    rpc.genesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
    await expect(ensureStreamActive()).rejects.toThrow("could not read the current mainnet slot");
    expect(changes()).toEqual([]);
  });

  it("refuses to touch a stream that is not pettycash-mainnet, whatever QN_STREAM_ID says", async () => {
    stream.name = "solsend-mvp-devnet";
    stream.network = "solana-devnet";
    await expect(ensureStreamActive()).rejects.toThrow(/does not point at pettycash-mainnet/);
    await expect(pauseStreamIfIdle(0)).rejects.toThrow(/does not point at pettycash-mainnet/);
    expect(changes()).toEqual([]);
  });

  it("throws when the app is not configured", async () => {
    delete process.env.QN_STREAM_ID;
    await expect(ensureStreamActive()).rejects.toThrow(/not set/);
    expect(calls).toEqual([]);
  });
});

describe("pauseStreamIfIdle", () => {
  const minutesAgo = (m: number) => ({ at: new Date(Date.now() - m * 60_000).toISOString() });

  it("pauses an active stream nobody has needed for longer than the limit", async () => {
    stream.status = "active";
    settings.value = minutesAgo(11);
    const r = await pauseStreamIfIdle(10);
    expect(r).toMatchObject({ paused: true, resumed: false, status: "paused" });
    expect(changes()).toEqual([`POST /streams/${ID}/pause`]);
  });

  it("pauses an active stream that was never marked as needed", async () => {
    stream.status = "active";
    expect((await pauseStreamIfIdle(10)).paused).toBe(true);
  });

  it("leaves a recently needed stream running", async () => {
    stream.status = "active";
    settings.value = minutesAgo(3);
    expect(await pauseStreamIfIdle(10)).toMatchObject({ paused: false, status: "active" });
    expect(changes()).toEqual([]);
  });

  it("does nothing when the stream is already paused", async () => {
    settings.value = minutesAgo(60);
    expect(await pauseStreamIfIdle(10)).toMatchObject({ paused: false, status: "paused" });
    expect(changes()).toEqual([]);
  });

  it("switches the stream back on, from the slot where it paused, when a purchase arrived during the pause", async () => {
    stream.status = "active";
    settings.value = minutesAgo(30);
    let reads = 0;
    // The purchase's mark lands after the idle check read the old one and before the check after pausing.
    settings.onRead = () => { if (++reads === 1) settings.value = { at: new Date().toISOString() }; };
    const r = await pauseStreamIfIdle(10);
    expect(r).toMatchObject({ paused: false, resumed: true, status: "active" });
    expect(changes()).toEqual([`POST /streams/${ID}/pause`, `PATCH /streams/${ID} {"start_range":${TIP}}`, `POST /streams/${ID}/activate`]);
  });
});

describe("streamStatus and safe output", () => {
  it("reports the state without the webhook URL, the token or the filter", async () => {
    stream.status = "active";
    settings.value = { at: "2026-11-20T02:00:00.000Z" };
    const s = await streamStatus();
    expect(s).toMatchObject({ configured: true, active: true, status: "active", error: null, lastNeededAt: Date.parse("2026-11-20T02:00:00.000Z") });
    expect(s.stream).toEqual({ id: ID, name: STREAM_NAME, status: "active", network: "solana-mainnet", dataset: "block", region: "usa_east", batch: 5, startRange: 100, endRange: -1, updatedAt: null });
    const text = JSON.stringify(s);
    for (const secret of ["secret.example", "tok_secret", "c2VjcmV0", KEY]) expect(text).not.toContain(secret);
    expect(JSON.stringify(summarize(stream))).not.toContain("secret");
  });

  it("never throws: missing configuration, a foreign stream and API failures are reported as errors", async () => {
    stream.name = "solsend-mvp-devnet";
    expect(await streamStatus()).toMatchObject({ configured: true, active: false, stream: null, error: "QN_STREAM_ID does not point at pettycash-mainnet" });
    process.env.QN_STREAM_ID = "00000000-0000-0000-0000-000000000000";
    expect(await streamStatus()).toMatchObject({ configured: true, active: false, error: "could not read the stream (HTTP 404: not found)" });
    delete process.env.QUICKNODE_API_KEY;
    expect(await streamStatus()).toMatchObject({ configured: false, active: false });
  });

  it("strips URLs and long hex strings from API error text", () => {
    const text = qnError({ status: 400, json: { message: `bad destination https://hooks.example/abc?token=1 token ${"ab".repeat(32)}` } });
    expect(text).toBe("HTTP 400: bad destination [url] token [redacted]");
  });

  it("reads the tip from STREAM_TIP_RPC_URL first when it is set", async () => {
    process.env.STREAM_TIP_RPC_URL = "https://private-rpc.example/key";
    expect(await mainnetTip()).toBe(TIP);
    expect(calls.every((c) => c.url === "https://private-rpc.example/key")).toBe(true);
  });
});
