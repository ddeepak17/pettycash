"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicConfig, Receipt } from "../types";
import * as api from "./api";
import { explainError } from "./errors";
import { emptyRun, reduceRun, type RunState } from "./run";

export function useNow(ms = 1000) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now ?? 0;
}

export function useConfig() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { setError(null); api.getConfig().then(setConfig, (e) => setError(explainError(e))); }, []);
  useEffect(load, [load]);
  return { config, error, retry: load };
}

export function useRun(config: PublicConfig | null) {
  const [state, setState] = useState<RunState>(emptyRun);
  const [error, setError] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const [lastPaidAt, setLastPaidAt] = useState(0);

  const start = useCallback(async (task: string, opts: { house: boolean; delegation?: string }) => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setError(null);
    setState({ ...emptyRun, phase: "running", task });
    try {
      await api.streamRun({ task, delegation: opts.delegation }, {
        house: opts.house, signal: c.signal,
        onEvent: (e) => {
          if (e.type === "paid" || e.type === "run_finished") setLastPaidAt(Date.now());
          setState((s) => reduceRun(s, e));
        },
      });
      setState((s) => (s.phase === "running" ? { ...s, phase: "failed", items: [...s.items, { kind: "error", message: "The connection closed before the run finished." }] } : s));
    } catch (e) {
      if ((e as Error).name === "AbortError") { setState((s) => ({ ...s, phase: "stopped" })); return; }
      setError(explainError(e));
      setState((s) => (s.items.length ? { ...s, phase: "failed" } : emptyRun));
    }
  }, []);
  const cancel = useCallback(() => ctl.current?.abort(), []);
  const reset = useCallback(() => { ctl.current?.abort(); setState(emptyRun); setError(null); }, []);
  const approve = useCallback(async (purchaseId: string, decision: "approved" | "denied") => {
    if (!state.runId) return;
    try { await api.approveRun(state.runId, { purchaseId, decision }); } catch (e) { setError(explainError(e)); }
  }, [state.runId]);
  useEffect(() => () => ctl.current?.abort(), []);
  void config;
  return { state, error, start, cancel, reset, approve, lastPaidAt };
}

/** Receipts for the owner (or the public feed). Polls every 2s while a receipt of the current run is unverified, for at most 60s after the last payment. */
export function useReceipts(source: { owner: string } | { feed: true } | null, runId: string | null, lastPaidAt: number) {
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = source ? ("owner" in source ? source.owner : "feed") : null;
  const latest = useRef<Receipt[] | null>(null);
  const load = useCallback(async () => {
    if (!source) return;
    try {
      const r = "owner" in source ? await api.getReceipts(source.owner) : await api.getFeed();
      latest.current = r.receipts; setReceipts(r.receipts); setError(null);
    } catch (e) { setError(explainError(e)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { setReceipts(null); latest.current = null; load(); }, [load]);
  useEffect(() => {
    if (!key || !lastPaidAt) return;
    const t = setInterval(() => {
      const mine = (latest.current ?? []).filter((r) => r.runId === runId);
      const pending = mine.length === 0 || mine.some((r) => !r.verified && !r.mismatch);
      if (Date.now() - lastPaidAt > 60000) { clearInterval(t); return; }
      if (pending) load();
    }, 2000);
    load();
    return () => clearInterval(t);
  }, [key, runId, lastPaidAt, load]);
  return { receipts, error, reload: load };
}
