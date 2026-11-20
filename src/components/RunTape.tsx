"use client";
import { explorerTx, formatUsd } from "@/lib/solana/cluster";
import type { Cluster } from "@/lib/types";
import type { Purchase, RunState } from "@/lib/client/run";
import { Countdown, Markdown, Spinner } from "./ui";

function Line({ label, children, tone }: { label: string; children: React.ReactNode; tone?: "bad" | "good" }) {
  return (
    <div className="flex gap-3 py-1 text-sm">
      <span className="eyebrow w-16 shrink-0 pt-0.5 sm:w-24">{label}</span>
      <div className={`min-w-0 flex-1 break-words ${tone === "bad" ? "text-bad" : ""}`}>{children}</div>
    </div>
  );
}

function PurchaseBlock({ p, cluster, onApprove, live }: { p: Purchase; cluster: Cluster; onApprove?: (id: string, d: "approved" | "denied") => void; live: boolean }) {
  const waiting = p.approval && !p.approval.result;
  return (
    <div className="slidein rounded border border-rule bg-card p-3 sm:p-4" data-testid="purchase">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="eyebrow">{p.kind === "reasoning" ? "Agent thinking, bought" : "Quote"}</div>
          <div className="break-words font-semibold">{p.seller.name}</div>
          <div className="text-sm text-muted">{p.description}</div>
        </div>
        <div className="mono shrink-0 text-lg font-semibold">{formatUsd(p.amountBase)}</div>
      </div>

      {p.checks ? (
        <details className="mt-2 text-sm">
          <summary>
            Rule check: {p.decision === "allow" ? "allowed" : p.decision === "ask" ? "needs your yes" : "refused"}
            <span className="text-muted"> ({p.checks.filter((c) => c.pass).length} of {p.checks.length} passed)</span>
          </summary>
          <ul className="mt-2 space-y-1 border-l-2 border-rule pl-3">
            {p.checks.map((c, i) => (
              <li key={i}><span aria-hidden className="mono mr-2">{c.pass ? "✓" : "✗"}</span><span className="sr-only">{c.pass ? "Passed: " : "Did not pass: "}</span><strong>{c.rule}.</strong> <span className="text-muted">{c.detail}</span></li>
            ))}
          </ul>
        </details>
      ) : null}

      {waiting ? (
        <div role="alertdialog" aria-label="Approval needed" className="mt-3 rounded border-2 border-accent bg-paper p-3">
          <p className="font-semibold">Your yes is needed</p>
          <p className="mt-1 text-sm">{p.approval!.reason}</p>
          <p className="mt-1 text-sm text-muted">Spend {formatUsd(p.amountBase)} at {p.seller.name}? It says no by itself in <Countdown until={p.approval!.expiresAt} />.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button className="btn btn-primary" onClick={() => onApprove?.(p.id, "approved")}>Approve {formatUsd(p.amountBase)}</button>
            <button className="btn" onClick={() => onApprove?.(p.id, "denied")}>Deny</button>
          </div>
        </div>
      ) : null}
      {p.approval?.result ? (
        <Line label="You">{p.approval.result === "approved" ? "Approved this purchase." : p.approval.result === "denied" ? "Said no. Nothing was bought." : "No answer in time, so it did not go ahead."}</Line>
      ) : null}

      <div className="mt-2">
        {p.pulled ? (
          <Line label="Pulled">
            {formatUsd(p.amountBase)} moved from the wallet to the agent.{" "}
            <a className="underline" target="_blank" rel="noopener noreferrer" href={explorerTx(p.pulled.signature, cluster)}>View on Solana ↗</a>
            <span className="text-muted"> · {formatUsd(p.pulled.remainingBase)} left</span>
          </Line>
        ) : null}
        {p.refused ? (
          <div className="mt-1 rounded border border-accent/50 bg-paper p-3 text-sm">
            <p className="font-semibold text-accent">Solana refused this: over the limit</p>
            <p className="mt-1">{p.refused.plain} That is the limit doing its job, not an error in the app. Nothing was spent on this purchase.</p>
            {p.refused.code !== null ? <p className="mono mt-1 text-xs text-muted">program error {p.refused.code} · {p.refused.name}</p> : null}
          </div>
        ) : null}
        {p.paid ? (
          <Line label="Paid">
            Seller paid, accepted with status {p.paid.httpStatus}.{" "}
            {p.paid.signature ? <a className="underline" target="_blank" rel="noopener noreferrer" href={explorerTx(p.paid.signature, cluster)}>View on Solana ↗</a> : <span className="text-muted">The seller did not report a transaction.</span>}
          </Line>
        ) : null}
        {p.delivered ? (
          <Line label="Came back">
            {(p.delivered.bytes / 1024).toFixed(p.delivered.bytes < 10240 ? 1 : 0)} KB
            <details className="mt-1"><summary className="text-muted">Preview</summary><p className="mono mt-1 whitespace-pre-wrap break-words rounded bg-paper p-2 text-xs">{p.delivered.preview}</p></details>
          </Line>
        ) : null}
        {p.failed ? (
          <Line label="Failed" tone="bad">
            {p.failed.error}
            {p.failed.refund?.status === "refunded" ? " The money was refunded." : p.failed.refund?.status === "pending" ? " A refund is pending." : ""}
          </Line>
        ) : null}
        {live && !p.paid && !p.refused && !p.failed && !waiting && p.pulled ? <Spinner label="Paying the seller" /> : null}
      </div>
    </div>
  );
}

export function RunTape({ run, cluster, onApprove, onCancel }: { run: RunState; cluster: Cluster; onApprove?: (id: string, d: "approved" | "denied") => void; onCancel?: () => void }) {
  const live = run.phase === "running";
  return (
    <section aria-label="The errand" aria-live="polite" className="sheet p-4 sm:p-6" data-testid="run-tape">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="eyebrow">Errand</div>
          <p className="mt-1 break-words font-medium">{run.task}</p>
        </div>
        {live && onCancel ? <button className="btn btn-small" onClick={onCancel}>Stop</button> : null}
      </div>
      <div className="mono mt-3 flex flex-wrap gap-x-6 gap-y-1 border-y border-dashed border-rule py-2 text-sm" data-testid="totals">
        <span>Spent <strong>{formatUsd(run.spentBase)}</strong></span>
        <span>Left <strong>{run.remainingBase !== null ? formatUsd(run.remainingBase) : "…"}</strong></span>
        {run.budgetBase ? <span className="text-muted">Budget for this errand {formatUsd(run.budgetBase)}</span> : null}
      </div>
      <div className="mt-4 space-y-3">
        {run.items.map((it, i) => {
          if (it.kind === "thinking") return <p key={i} className="slidein mono text-sm text-muted">› {it.text}</p>;
          if (it.kind === "purchase") return <PurchaseBlock key={i} p={run.purchases[it.id]} cluster={cluster} onApprove={onApprove} live={live} />;
          if (it.kind === "error") return <p key={i} role="alert" className="rounded border border-bad bg-[var(--bad-bg)] p-3 text-sm text-bad">{it.message}</p>;
          return (
            <div key={i} className="slidein perf pt-4" data-testid="answer">
              <div className="eyebrow mb-2">Answer</div>
              <Markdown text={it.text} />
            </div>
          );
        })}
        {live ? <Spinner label={run.items.length ? "Working" : "Starting the errand"} /> : null}
        {run.phase === "stopped" ? <p className="text-sm text-muted">Stopped. Anything already paid still has a receipt below.</p> : null}
        {run.phase === "done" && run.finish ? (
          <p className="mono text-xs text-muted">Done in {(run.finish.ms / 1000).toFixed(1)}s · {run.finish.purchases} {run.finish.purchases === 1 ? "purchase" : "purchases"} · {formatUsd(run.finish.spentBase)} spent</p>
        ) : null}
      </div>
    </section>
  );
}
