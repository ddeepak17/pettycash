// Switching the QuickNode stream on and off from inside the app, plus the REST calls the CLI shares.
//
// Billing is per processed block (about 2.5 mainnet blocks a second), so the stream runs only while purchases
// are happening: ensureStreamActive() before a purchase, pauseStreamIfIdle() from a timer afterwards.
// Nothing here ever returns or logs the API key, the webhook URL or the security token.
import { getSetting, setSetting } from "./store";

export const STREAM_NAME = "pettycash-mainnet";
export const STREAM_NETWORK = "solana-mainnet";
export const STREAM_DATASET = "block";
export const QN_API = "https://api.quicknode.com/streams/rest/v1";
export const MAINNET_RPC = "https://api.mainnet-beta.solana.com";
/** First 32 characters of the mainnet genesis hash; a tip is only trusted from an RPC that reports it. */
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const LAST_NEEDED_KEY = "stream_last_needed";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type QnResponse = { status: number; json: any };

export async function qnRequest(apiKey: string, method: string, path: string, body?: unknown): Promise<QnResponse> {
  const res = await fetch(`${QN_API}${path}`, {
    method,
    headers: { "x-api-key": apiKey, "content-type": "application/json", accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, json };
}

/** Why a call failed, without echoing anything that could hold a URL or token. */
export const qnError = (r: QnResponse): string => {
  const raw = r.json?.error ?? r.json?.message ?? r.json?.detail ?? r.json?.raw ?? "";
  const text = (typeof raw === "string" ? raw : JSON.stringify(raw)).replace(/https?:\/\/\S+/g, "[url]").replace(/[0-9a-fA-F]{40,}/g, "[redacted]").slice(0, 300);
  return `HTTP ${r.status}${text ? `: ${text}` : ""}`;
};

export type StreamSummary = {
  id: string | null;
  name: string | null;
  status: string | null;
  network: string | null;
  dataset: string | null;
  region: string | null;
  batch: number | null;
  startRange: number | null;
  endRange: number | null;
  updatedAt: string | null;
};

/** The fields that are safe to show. Never the destination URL, its headers, the security token or the filter. */
export const summarize = (s: any): StreamSummary => ({
  id: s?.id ?? null,
  name: s?.name ?? null,
  status: s?.status ?? null,
  network: s?.network ?? null,
  dataset: s?.dataset ?? null,
  region: s?.region ?? null,
  batch: s?.dataset_batch_size ?? null,
  startRange: s?.start_range ?? null,
  endRange: s?.end_range ?? null,
  updatedAt: s?.updated_at ?? null,
});

/** Guard used before every change: the stream must be ours. The account holds another product's stream too. */
export const isOurStream = (s: any): boolean => s?.name === STREAM_NAME && s?.network === STREAM_NETWORK;

async function rpcCall(url: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const j = (await res.json()) as { result?: unknown; error?: unknown };
  if (j.error !== undefined || j.result === undefined) throw new Error("RPC error");
  return j.result;
}

/**
 * The current mainnet slot. Tries STREAM_TIP_RPC_URL (optional, for hosts the public RPC rate-limits), then the
 * public RPC. An RPC is trusted only if it reports the mainnet genesis hash: a devnet slot is a larger number and
 * would park the stream in the future.
 */
export async function mainnetTip(): Promise<number> {
  const urls = [process.env.STREAM_TIP_RPC_URL, MAINNET_RPC].filter((u): u is string => !!u);
  for (const url of urls) {
    try {
      const genesis = await rpcCall(url, "getGenesisHash", []);
      if (typeof genesis !== "string" || !genesis.startsWith(MAINNET_GENESIS)) continue;
      const slot = await rpcCall(url, "getSlot", [{ commitment: "confirmed" }]);
      if (typeof slot === "number" && Number.isSafeInteger(slot) && slot > 0) return slot;
    } catch { /* try the next one */ }
  }
  throw new Error("could not read the current mainnet slot");
}

export async function fetchStream(apiKey: string, id: string): Promise<any> {
  const r = await qnRequest(apiKey, "GET", `/streams/${id}`);
  if (r.status >= 300) throw new Error(`could not read the stream (${qnError(r)})`);
  return r.json;
}

/**
 * Activates a stream that is not running. It first moves start_range to the chain tip: a stopped stream resumes
 * from its stored start_range, and without this it would replay, and bill for, every block since.
 * Refuses to activate when the tip cannot be read or the move is rejected.
 */
export async function activateAtTip(apiKey: string, stream: any, fromSlot?: number): Promise<{ startRange: number; status: string | null }> {
  if (!isOurStream(stream)) throw new Error(`refusing to change a stream that is not ${STREAM_NAME}`);
  const startRange = fromSlot ?? (await mainnetTip());
  const moved = await qnRequest(apiKey, "PATCH", `/streams/${stream.id}`, { start_range: startRange });
  if (moved.status >= 300) throw new Error(`could not move start_range to the tip; not activating (${qnError(moved)})`);
  let r = await qnRequest(apiKey, "POST", `/streams/${stream.id}/activate`);
  if (r.status >= 300) r = await qnRequest(apiKey, "PATCH", `/streams/${stream.id}`, { status: "active" });
  if (r.status >= 300) throw new Error(`could not activate the stream (${qnError(r)})`);
  const after = await fetchStream(apiKey, stream.id);
  return { startRange, status: after?.status ?? null };
}

export async function pauseStream(apiKey: string, stream: any): Promise<string | null> {
  if (!isOurStream(stream)) throw new Error(`refusing to change a stream that is not ${STREAM_NAME}`);
  let r = await qnRequest(apiKey, "POST", `/streams/${stream.id}/pause`);
  if (r.status >= 300) r = await qnRequest(apiKey, "PATCH", `/streams/${stream.id}`, { status: "paused" });
  if (r.status >= 300) throw new Error(`could not pause the stream (${qnError(r)})`);
  const after = await fetchStream(apiKey, stream.id);
  return after?.status ?? null;
}

// ── Used by the deployed app ─────────────────────────────────────────────────

function appConfig(): { apiKey: string; id: string } | null {
  const apiKey = process.env.QUICKNODE_API_KEY;
  const id = process.env.QN_STREAM_ID;
  return apiKey && id ? { apiKey, id } : null;
}

type LastNeeded = { at: string };
async function lastNeededMs(): Promise<number | null> {
  const row = await getSetting<LastNeeded>(LAST_NEEDED_KEY);
  const ms = row && typeof row.value?.at === "string" ? Date.parse(row.value.at) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

export type StreamStatus = {
  /** False when QUICKNODE_API_KEY or QN_STREAM_ID is missing. */
  configured: boolean;
  active: boolean;
  status: string | null;
  stream: StreamSummary | null;
  /** When a purchase last asked for the stream (unix ms), or null. */
  lastNeededAt: number | null;
  error: string | null;
};

/** The stream's state as QuickNode reports it right now. Never throws; problems are in `error`. */
export async function streamStatus(): Promise<StreamStatus> {
  const cfg = appConfig();
  let lastNeededAt: number | null = null;
  try { lastNeededAt = await lastNeededMs(); } catch { /* the stream's own state is still worth reporting */ }
  if (!cfg) return { configured: false, active: false, status: null, stream: null, lastNeededAt, error: "QUICKNODE_API_KEY or QN_STREAM_ID is not set" };
  try {
    const stream = await fetchStream(cfg.apiKey, cfg.id);
    if (!isOurStream(stream)) return { configured: true, active: false, status: null, stream: null, lastNeededAt, error: `QN_STREAM_ID does not point at ${STREAM_NAME}` };
    return { configured: true, active: stream.status === "active", status: stream.status ?? null, stream: summarize(stream), lastNeededAt, error: null };
  } catch (e) {
    return { configured: true, active: false, status: null, stream: null, lastNeededAt, error: e instanceof Error ? e.message : "could not read the stream" };
  }
}

/**
 * Call before a purchase. Records that the stream is needed now (key stream_last_needed in settings), then, if
 * the stream is not running, moves start_range to the tip and activates it.
 * Throws when the stream cannot be made active: the caller should say receipts will stay unverified.
 */
export async function ensureStreamActive(): Promise<{ active: boolean; activated: boolean; status: string | null; startRange: number | null }> {
  const cfg = appConfig();
  if (!cfg) throw new Error("QUICKNODE_API_KEY or QN_STREAM_ID is not set");
  // Written BEFORE reading the stream's state: see pauseStreamIfIdle for why the order matters.
  await setSetting(LAST_NEEDED_KEY, { at: new Date().toISOString() } satisfies LastNeeded);
  const stream = await fetchStream(cfg.apiKey, cfg.id);
  if (!isOurStream(stream)) throw new Error(`QN_STREAM_ID does not point at ${STREAM_NAME}`);
  if (stream.status === "active") return { active: true, activated: false, status: "active", startRange: stream.start_range ?? null };
  const r = await activateAtTip(cfg.apiKey, stream);
  return { active: r.status === "active", activated: true, status: r.status, startRange: r.startRange };
}

/**
 * Call from a timer. Pauses the stream when no purchase has needed it for `maxIdleMinutes`.
 *
 * A purchase can start at the very moment this decides to pause. ensureStreamActive writes its mark before it
 * looks at the stream, and this function reads the mark again after pausing: if a purchase arrived in between,
 * the stream is switched back on from the slot where it was paused, so no block of that purchase is skipped.
 */
export async function pauseStreamIfIdle(maxIdleMinutes: number): Promise<{ paused: boolean; resumed: boolean; status: string | null; idleMinutes: number | null }> {
  const cfg = appConfig();
  if (!cfg) throw new Error("QUICKNODE_API_KEY or QN_STREAM_ID is not set");
  const before = await lastNeededMs();
  const idleMinutes = before === null ? null : (Date.now() - before) / 60_000;
  const stream = await fetchStream(cfg.apiKey, cfg.id);
  if (!isOurStream(stream)) throw new Error(`QN_STREAM_ID does not point at ${STREAM_NAME}`);
  if (stream.status !== "active") return { paused: false, resumed: false, status: stream.status ?? null, idleMinutes };
  if (idleMinutes !== null && idleMinutes < maxIdleMinutes) return { paused: false, resumed: false, status: "active", idleMinutes };

  let pausedAtSlot: number | null = null;
  try { pausedAtSlot = await mainnetTip(); } catch { /* pausing matters more than the resume point */ }
  const status = await pauseStream(cfg.apiKey, stream);
  const after = await lastNeededMs();
  if (after !== null && after !== before) {
    const again = await fetchStream(cfg.apiKey, cfg.id);
    if (again.status === "active") return { paused: false, resumed: true, status: "active", idleMinutes: 0 };
    const r = await activateAtTip(cfg.apiKey, again, pausedAtSlot ?? undefined);
    return { paused: false, resumed: true, status: r.status, idleMinutes: 0 };
  }
  return { paused: status !== "active", resumed: false, status, idleMinutes };
}
