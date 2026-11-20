"use client";
import { useEffect, useState } from "react";
import { explorerAddress, formatUsd, parseUsd, shortAddress } from "@/lib/solana/cluster";
import type { Allowance, AllowanceState, ProofResult, PublicConfig } from "@/lib/types";
import * as api from "@/lib/client/api";
import { createPettyCash, revokePettyCash, signIn, type CreateStep } from "@/lib/client/chain";
import { explainError } from "@/lib/client/errors";
import { useAppWallet } from "@/lib/client/wallet";
import { Modal } from "./Modal";
import { Countdown, ErrorNote, Spinner, fmtWhen } from "./ui";

export function CashBox({ config, state, selected, onSelect, onChanged, onSignedIn }: {
  config: PublicConfig; state: AllowanceState | null; selected: Allowance | null; onSelect: (a: Allowance) => void; onChanged: () => void; onSignedIn: () => void;
}) {
  const w = useAppWallet();
  const [newOpen, setNewOpen] = useState(false);
  const [proof, setProof] = useState<{ busy: boolean; result?: ProofResult; error?: string } | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const live = (state?.allowances ?? []).filter((a) => !a.expired);

  const test = async () => {
    if (!selected) return;
    setProof({ busy: true });
    try { setProof({ busy: false, result: await api.proveOverspend(selected.address, selected.remainingBase, true) }); }
    catch (e) { setProof({ busy: false, error: explainError(e) }); }
  };
  const revoke = async () => {
    if (!selected) return;
    setRevoking(true); setMsg(null);
    try { await revokePettyCash(w, config, selected); onChanged(); }
    catch (e) { setMsg(explainError(e)); }
    setRevoking(false);
  };

  return (
    <aside aria-label="Your petty cash" className="lg:sticky lg:top-6">
      <div className="torn-wrap"><div className="torn px-5 pt-5">
        <div className="eyebrow">Your petty cash</div>
        {!state ? <div className="mt-3 space-y-3" aria-busy="true"><div className="skeleton h-9 w-32" /><div className="skeleton h-4" /><div className="skeleton h-4 w-2/3" /></div> : null}
        {state && !selected ? (
          <div className="mt-2">
            <p className="text-lg font-semibold">Nothing set aside yet</p>
            <p className="mt-1 text-sm text-muted">Set aside a small amount for the agent. The most it can ever spend is what you put here.</p>
            <dl className="mono mt-4 space-y-1 text-xs text-muted">
              <div className="flex justify-between"><dt>USDC in wallet</dt><dd>{formatUsd(state.usdcBalanceBase)}</dd></div>
              <div className="flex justify-between"><dt>SOL for network fees</dt><dd>{(Number(state.solLamports) / 1e9).toFixed(4)}</dd></div>
            </dl>
          </div>
        ) : null}
        {selected ? <Meter a={selected} cluster={config.cluster} agent={config.agent} /> : null}
        {live.length > 1 ? (
          <label className="mt-3 block text-xs text-muted">Showing
            <select className="field mt-1 !py-1.5 text-sm" value={selected?.address} onChange={(e) => onSelect(live.find((a) => a.address === e.target.value)!)}>
              {live.map((a) => <option key={a.address} value={a.address}>{formatUsd(a.remainingBase)} left · until {fmtWhen(a.expiryTs)}</option>)}
            </select>
          </label>
        ) : null}
        {state ? (
          <div className="mt-5 flex flex-wrap gap-2">
            <button className="btn btn-primary btn-small" onClick={() => setNewOpen(true)}>{selected ? "New petty cash" : "Set aside petty cash"}</button>
            {selected ? <button className="btn btn-small" onClick={test} disabled={proof?.busy}>Test the limit</button> : null}
            {selected ? <button className="btn btn-small btn-danger" onClick={revoke} disabled={revoking}>{revoking ? "Revoking…" : "Revoke"}</button> : null}
          </div>
        ) : null}
        {selected ? <p className="mt-2 text-xs text-muted">Revoke closes this petty cash right away. Any unspent money stays in your wallet; it never left.</p> : null}
        {msg ? <div className="mt-3"><ErrorNote>{msg}</ErrorNote></div> : null}
        <details className="mt-4 text-xs text-muted">
          <summary>Technical details</summary>
          <dl className="mono mt-2 space-y-1 break-all">
            <div><dt className="inline">Program </dt><dd className="inline">{config.allowancesProgram}</dd></div>
            {selected ? <div><dt className="inline">Allowance account </dt><dd className="inline"><a className="underline" target="_blank" rel="noopener noreferrer" href={explorerAddress(selected.address, config.cluster)}>{selected.address}</a></dd></div> : null}
            <div><dt className="inline">Token </dt><dd className="inline">{config.usdcMint}</dd></div>
          </dl>
        </details>
      </div></div>

      <NewCash open={newOpen} onClose={() => setNewOpen(false)} config={config} state={state} onDone={() => { setNewOpen(false); onChanged(); }} onSignedIn={onSignedIn} />
      <Modal open={!!proof} onClose={() => setProof(null)} title="Testing the limit">
        {proof?.busy ? <div className="py-4"><Spinner label="Asking Solana to pull more than what is left…" /></div> : null}
        {proof?.error ? <ErrorNote>{proof.error}</ErrorNote> : null}
        {proof?.result ? <ProofView r={proof.result} cluster={config.cluster} /> : null}
      </Modal>
    </aside>
  );
}

const peaks = new Map<string, bigint>();
function Meter({ a, cluster, agent }: { a: Allowance; cluster: PublicConfig["cluster"]; agent: string }) {
  const rem = BigInt(a.remainingBase);
  const peak = (peaks.get(a.address) ?? 0n) > rem ? peaks.get(a.address)! : rem;
  peaks.set(a.address, peak);
  const pct = peak === 0n ? 0 : Number((rem * 1000n) / peak) / 10;
  return (
    <div className="mt-2" data-testid="cashbox">
      <div className="mono text-4xl font-semibold tracking-tight">{formatUsd(a.remainingBase)}</div>
      <div className="text-sm text-muted">left to spend</div>
      <div className="meter mt-3" role="img" aria-label={`${formatUsd(a.remainingBase)} left`}><div style={{ width: `${pct}%` }} /></div>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-3"><dt className="text-muted">Expires</dt><dd className="mono text-right">{a.expiryTs ? <>{fmtWhen(a.expiryTs)} · in <Countdown until={a.expiryTs * 1000} /></> : "Never"}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted">The agent</dt><dd className="mono"><a className="underline" target="_blank" rel="noopener noreferrer" href={explorerAddress(agent, cluster)} title={agent}>{shortAddress(agent)}</a></dd></div>
      </dl>
    </div>
  );
}

function ProofView({ r, cluster }: { r: ProofResult; cluster: PublicConfig["cluster"] }) {
  return (
    <div>
      <p className={`text-lg font-semibold ${r.refused ? "text-accent" : "text-bad"}`}>{r.refused ? "Solana refused it. The limit holds." : "The test did not get refused. Treat this as a problem."}</p>
      <p className="mt-2 text-sm">We asked the chain to pull <strong className="mono">{formatUsd(r.attemptedBase)}</strong> when only <strong className="mono">{formatUsd(r.remainingBase)}</strong> was left.</p>
      <p className="mt-2 text-sm">{r.plain}</p>
      <p className="mono mt-2 text-xs text-muted">{r.code !== null ? `program error ${r.code} · ` : ""}{r.name}</p>
      {r.signature ? <p className="mt-3 text-sm"><a className="underline" target="_blank" rel="noopener noreferrer" href={`https://explorer.solana.com/tx/${r.signature}${cluster === "devnet" ? "?cluster=devnet" : ""}`}>Open the failed transaction on Solana Explorer ↗</a></p> : <p className="mt-3 text-xs text-muted">This was simulated and not sent to the chain, so there is no transaction to open.</p>}
      <details className="mt-3 text-sm"><summary>Raw logs</summary><pre className="mono mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-paper p-2 text-xs">{r.logs.join("\n")}</pre></details>
    </div>
  );
}

const PICKS = ["0.25", "1.00", "5.00"];

function NewCash({ open, onClose, config, state, onDone, onSignedIn }: { open: boolean; onClose: () => void; config: PublicConfig; state: AllowanceState | null; onDone: () => void; onSignedIn: () => void }) {
  const w = useAppWallet();
  const [amount, setAmount] = useState("1.00");
  const [hours, setHours] = useState(24);
  const [step, setStep] = useState<CreateStep | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setStep(null); setErr(null); } }, [open]);
  if (!state) return null;
  const base = parseUsd(amount);
  const balance = BigInt(state.usdcBalanceBase);
  const sol = BigInt(state.solLamports);
  const expiryTs = Math.floor(Date.now() / 1000) + hours * 3600;
  let problem: string | null = null;
  if (balance === 0n) problem = "This wallet has no USDC. Add some USDC first, then come back.";
  else if (sol < 10_000n) problem = "This wallet has no SOL for the network fee. Add a small amount of SOL (about $1 is plenty), then come back.";
  else if (base === null || base === 0n) problem = "Enter an amount like 1.00.";
  else if (base > balance) problem = `That is more than the ${formatUsd(balance)} USDC in this wallet.`;
  const busy = step !== null && step !== "done";
  const go = async () => {
    if (!base || problem) return;
    setErr(null);
    try {
      await signIn(w); onSignedIn();
      await createPettyCash({ wallet: w, config, state, amount: base, expiryTs, onStep: setStep });
      onDone();
    } catch (e) { setErr(explainError(e)); setStep(null); }
  };
  const when = new Date(expiryTs * 1000).toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" });
  return (
    <Modal open={open} onClose={() => (busy ? undefined : onClose())} title="New petty cash">
      <div className="space-y-4">
        <p className="text-sm text-muted">{config.cluster === "mainnet-beta" ? "This is real USDC." : "This is test money."} You keep the money in your wallet. You are only setting a limit on what the agent may pull.</p>
        <div>
          <label htmlFor="amt" className="text-sm font-semibold">Amount in USDC</label>
          <div className="mt-1 flex flex-wrap gap-2">
            <input id="amt" inputMode="decimal" className="field mono !w-32" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />
            {PICKS.map((p) => <button key={p} type="button" className="btn btn-small" onClick={() => setAmount(p)} disabled={busy}>${p}</button>)}
          </div>
          <p className="mono mt-1 text-xs text-muted">In your wallet: {formatUsd(balance)} USDC</p>
        </div>
        <div>
          <label htmlFor="exp" className="text-sm font-semibold">Expires after</label>
          <select id="exp" className="field mt-1 !w-48" value={hours} onChange={(e) => setHours(Number(e.target.value))} disabled={busy}>
            <option value={1}>1 hour</option><option value={6}>6 hours</option><option value={24}>24 hours</option><option value={72}>3 days</option><option value={168}>7 days</option>
          </select>
        </div>
        <div className="rounded border border-rule bg-paper p-3 text-sm">
          <p className="eyebrow mb-2">What your wallet will ask you to sign</p>
          <ol className="space-y-2">
            {!state.authorityInitialized ? <li className={step === "setup" ? "font-semibold" : ""}><strong>1. One-time setup for this wallet.</strong> Lets Solana&apos;s audited allowance program hold limits for you. No money moves.</li> : null}
            <li className={step === "create" ? "font-semibold" : ""}><strong>{state.authorityInitialized ? "1" : "2"}. Set aside {base !== null ? formatUsd(base) : "…"} until {when}.</strong> After that the agent cannot pull anything, and you can revoke sooner.</li>
          </ol>
          <p className="mt-2 text-xs text-muted">Before your first errand you will also sign in with a message. That is free and is not a transaction.</p>
        </div>
        {problem ? <p role="alert" className="text-sm text-bad">{problem}</p> : null}
        {err ? <ErrorNote>{err}</ErrorNote> : null}
        {busy ? <Spinner label={step === "setup" ? "Waiting for the one-time setup. Approve it in your wallet." : "Waiting for your approval in the wallet."} /> : null}
        <div className="flex gap-3">
          <button className="btn btn-primary" onClick={go} disabled={busy || !!problem}>{err ? "Try again" : "Continue to wallet"}</button>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
