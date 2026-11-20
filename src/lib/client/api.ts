// Every network call the browser makes lives here. NEXT_PUBLIC_MOCK=1 swaps in scripted preview data.
import { Connection } from "@solana/web3.js";
import type { AllowanceState, ApprovalRequest, AuthChallenge, AuthSession, ProofResult, PublicConfig, ReceiptsResponse, RunDetail, RunEvent, RunRequest } from "../types";
import * as mock from "./mock";

export const MOCK = process.env.NEXT_PUBLIC_MOCK === "1";

export class ApiError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: "same-origin", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("Could not reach the server. Check your connection and try again.");
  }
  if (!res.ok) {
    let msg = `The server answered with an error (${res.status}).`;
    try { const b = await res.json(); if (b?.error && typeof b.error === "string") msg = b.error; } catch {}
    throw new ApiError(msg, res.status);
  }
  return res.json() as Promise<T>;
}
const post = <T>(path: string, body?: unknown) => json<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });

export const getConfig = (): Promise<PublicConfig> => (MOCK ? Promise.resolve(mock.mockConfig()) : json("/api/config"));
export const getAllowance = (owner: string): Promise<AllowanceState> => (MOCK ? Promise.resolve(mock.mockAllowance(owner)) : json(`/api/allowance?owner=${encodeURIComponent(owner)}`));

export const authChallenge = (owner: string): Promise<AuthChallenge> => (MOCK ? Promise.resolve({ message: "Sign in to Petty Cash (preview)", expiresAt: Date.now() + 300000 }) : post("/api/auth/challenge", { owner }));
export const authVerify = async (owner: string, message: string, signature: string): Promise<AuthSession> => {
  if (MOCK) { mock.mockSignIn(); return { owner }; }
  return post("/api/auth/verify", { owner, message, signature });
};
export const authMe = (): Promise<AuthSession> => (MOCK ? Promise.resolve(mock.mockSession()) : json("/api/auth/me"));
export const authLogout = async (): Promise<void> => { if (MOCK) mock.mockSignOut(); else await post("/api/auth/logout"); };

export const getReceipts = (owner: string, limit = 50): Promise<ReceiptsResponse> =>
  MOCK ? Promise.resolve({ receipts: mock.mockReceipts(owner, false) }) : json(`/api/receipts?owner=${encodeURIComponent(owner)}&limit=${limit}`);
export const getFeed = (): Promise<ReceiptsResponse> => (MOCK ? Promise.resolve({ receipts: mock.mockReceipts("", true) }) : json("/api/feed"));
export const getRun = (id: string): Promise<RunDetail> => (MOCK ? Promise.resolve(mock.mockRunDetail(id)) : json(`/api/runs/${encodeURIComponent(id)}`));

export const approveRun = async (runId: string, req: ApprovalRequest): Promise<void> => {
  if (MOCK) { mock.mockApprove(req.purchaseId, req.decision); return; }
  await post(`/api/run/${encodeURIComponent(runId)}/approve`, req);
};

export async function proveOverspend(delegation: string, remainingBase: string, send = true): Promise<ProofResult> {
  if (MOCK) return mock.mockProof(remainingBase);
  return post("/api/prove/overspend", { delegation, send });
}

/** Streams a run. Resolves when the stream ends. Abort the signal to cancel. */
export async function streamRun(req: RunRequest, opts: { house: boolean; signal: AbortSignal; onEvent: (e: RunEvent) => void }): Promise<void> {
  if (MOCK) return mock.mockRun(req, opts.house, opts.onEvent, opts.signal);
  const res = await fetch(opts.house ? "/api/house/run" : "/api/run", {
    method: "POST", credentials: "same-origin", signal: opts.signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(opts.house ? { task: req.task } : req),
  });
  if (!res.ok || !res.body) {
    let msg = `The run could not start (${res.status}).`;
    try { const b = await res.json(); if (typeof b?.error === "string") msg = b.error; } catch {}
    throw new ApiError(msg, res.status);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const flush = (line: string) => {
    const t = line.trim();
    if (!t) return;
    try { opts.onEvent(JSON.parse(t) as RunEvent); } catch { /* ignore a malformed line */ }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) { flush(buf.slice(0, i)); buf = buf.slice(i + 1); }
  }
  flush(buf);
}

let conn: { url: string; c: Connection } | null = null;
/** web3.js connection through the same-origin RPC proxy. HTTP only. */
export function getConnection(config: PublicConfig): Connection {
  const url = new URL(config.rpcUrl, window.location.origin).toString();
  if (!conn || conn.url !== url) conn = { url, c: new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true }) };
  return conn.c;
}

/** Polls getSignatureStatuses until the transaction is confirmed. Never uses websockets. */
export async function waitForSignature(connection: Connection, signature: string, timeoutMs = 60000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const st = value[0];
    if (st?.err) throw new Error("The transaction was rejected by the network: " + JSON.stringify(st.err));
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Timed out waiting for the network to confirm. It may still land; check your wallet history before retrying.");
}
