"use client";
import { useCallback, useEffect, useState } from "react";
import { formatUsd } from "@/lib/solana/cluster";
import type { Allowance, AllowanceState } from "@/lib/types";
import * as api from "@/lib/client/api";
import { signIn } from "@/lib/client/chain";
import { explainError } from "@/lib/client/errors";
import { useConfig, useReceipts, useRun } from "@/lib/client/hooks";
import { useAppWallet } from "@/lib/client/wallet";
import { Catalog } from "./Catalog";
import { CashBox } from "./CashBox";
import { Enforcement, Feed, Steps } from "./Landing";
import { ReceiptList } from "./Receipt";
import { RunTape } from "./RunTape";
import { TaskBox } from "./TaskBox";
import { TopBar } from "./TopBar";
import { ErrorNote, Spinner } from "./ui";

export default function App() {
  const { config, error: cfgError, retry } = useConfig();
  const w = useAppWallet();
  const run = useRun(config);
  const [state, setState] = useState<AllowanceState | null>(null);
  const [stateErr, setStateErr] = useState<string | null>(null);
  const [selectedAddr, setSelectedAddr] = useState<string | null>(null);
  const [signErr, setSignErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"house" | "wallet" | null>(null);
  const address = w.status === "connected" ? w.address : null;

  const loadState = useCallback(async () => {
    if (!address) { setState(null); return; }
    try { const s = await api.getAllowance(address); setState(s); setStateErr(null); }
    catch (e) { setStateErr(explainError(e)); }
  }, [address]);
  useEffect(() => { setState(null); setSelectedAddr(null); void loadState(); }, [loadState]);

  const live = (state?.allowances ?? []).filter((a) => !a.expired);
  const selected: Allowance | null = live.find((a) => a.address === selectedAddr) ?? live[0] ?? null;

  const owned = useReceipts(address ? { owner: address } : null, run.state.runId, run.lastPaidAt);
  const feed = useReceipts(address ? null : { feed: true }, run.state.runId, run.lastPaidAt);
  // After a run, refresh the balance.
  useEffect(() => { if (run.state.phase === "done" || run.state.phase === "stopped") void loadState(); }, [run.state.phase, loadState]);

  const runHouse = (task: string) => { setMode("house"); void run.start(task, { house: true }); };
  const runOwn = async (task: string) => {
    if (!selected || !address) return;
    setSignErr(null);
    try { await signIn(w); } catch (e) { setSignErr(explainError(e)); return; }
    setMode("wallet");
    void run.start(task, { house: false, delegation: selected.address });
  };
  const busy = run.state.phase === "running";
  const cluster = config?.cluster ?? "mainnet-beta";
  const real = cluster === "mainnet-beta";

  return (
    <>
      <TopBar config={config} />
      <main id="main" className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        {cfgError ? <div className="mt-8"><ErrorNote onRetry={retry}>{cfgError}</ErrorNote></div> : null}
        {!config && !cfgError ? <div className="mt-12 space-y-4" aria-busy="true"><Spinner label="Loading" /><div className="skeleton h-40 max-w-2xl" /></div> : null}

        {config && !address ? (
          <>
            <section className="grid gap-10 pb-4 pt-10 sm:pt-16 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
              <div>
                <p className="eyebrow">{real ? "Real USDC · Solana mainnet" : "Test money · Solana devnet"}</p>
                <h1 className="mt-3 text-[2.4rem] font-semibold leading-[1.05] tracking-tight sm:text-6xl">Give your AI petty cash, not your wallet.</h1>
                <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
                  Set aside a small budget and let an agent run an errand. It pays real companies a fraction of a cent at a time, and Solana itself makes sure it can never spend more than you set aside.
                </p>
                <p className="mt-3 max-w-xl text-sm text-muted">Never holds your money. Every receipt checked independently.</p>
              </div>
              <div className="sheet h-fit p-5 sm:p-6">
                {config.house ? (
                  <>
                    <h2 className="text-xl font-semibold">Try it now, on us</h2>
                    <p className="mt-1 mb-4 text-sm text-muted">No wallet needed. This spends the house petty cash{real ? ", which is real money" : ", which is test money"}: up to {formatUsd(config.house.perRunBudgetBase)} per errand.</p>
                    <TaskBox onRun={runHouse} busy={busy} label="Run on the house petty cash" />
                  </>
                ) : (
                  <div><h2 className="text-xl font-semibold">The house petty cash is switched off</h2><p className="mt-2 text-sm text-muted">Connect your own wallet to try it with a budget of your own.</p></div>
                )}
                <div className="perf mt-5 flex flex-wrap items-center gap-3 pt-4">
                  <button className="btn btn-small" onClick={() => document.querySelector<HTMLButtonElement>("header button.btn")?.click()}>Use your own wallet</button>
                  <span className="text-xs text-muted">Phantom, Solflare or Backpack.</span>
                </div>
              </div>
            </section>
            {run.error ? <div className="mt-6"><ErrorNote>{run.error}</ErrorNote></div> : null}
            {run.state.phase !== "idle" ? (
              <div className="mt-8 grid gap-8 lg:grid-cols-[1.1fr_1fr]">
                <RunTape run={run.state} cluster={cluster} onApprove={run.approve} onCancel={run.cancel} />
                <div><h2 className="eyebrow mb-3">Receipts</h2><ReceiptList receipts={mode === "house" ? feed.receipts : null} error={feed.error} cluster={cluster} empty="No receipts yet." showWallet /></div>
              </div>
            ) : null}
            <Steps />
            <Catalog config={config} />
            <Enforcement config={config} />
            <Feed config={config} receipts={feed.receipts} error={feed.error} />
          </>
        ) : null}

        {config && address ? (
          <div className="grid gap-8 pt-8 lg:grid-cols-[22rem_1fr]">
            <CashBox config={config} state={state} selected={selected} onSelect={(a) => setSelectedAddr(a.address)} onChanged={loadState} onSignedIn={() => setSignErr(null)} />
            <div className="min-w-0 space-y-8">
              {stateErr ? <ErrorNote onRetry={loadState}>{stateErr}</ErrorNote> : null}
              <section className="sheet p-5 sm:p-6">
                <TaskBox
                  onRun={runOwn} busy={busy} label="Run on my petty cash"
                  disabled={!selected} disabledReason={state && !selected ? "Set aside some petty cash first." : undefined}
                  note={selected ? `Spends from your ${formatUsd(selected.remainingBase)}. You will sign in once, for free; it is not a transaction.` : undefined}
                />
                {signErr ? <div className="mt-3"><ErrorNote>{signErr}</ErrorNote></div> : null}
                {run.error ? <div className="mt-3"><ErrorNote>{run.error}</ErrorNote></div> : null}
              </section>
              {run.state.phase !== "idle" ? <RunTape run={run.state} cluster={cluster} onApprove={run.approve} onCancel={run.cancel} /> : null}
              <section aria-labelledby="rc">
                <h2 id="rc" className="text-xl font-semibold">Receipts</h2>
                <div className="mt-4"><ReceiptList receipts={owned.receipts} error={owned.error} cluster={cluster} empty="No receipts yet. Run an errand and each purchase shows up here." /></div>
              </section>
            </div>
          </div>
        ) : null}
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-muted sm:px-6">Petty Cash. The limit lives in Solana&apos;s Subscriptions and Allowances program.</footer>
    </>
  );
}
