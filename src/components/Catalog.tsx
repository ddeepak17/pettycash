"use client";
import { formatUsd } from "@/lib/solana/cluster";
import type { PublicConfig } from "@/lib/types";

function record(r: { purchases: number; delivered: number }) {
  return r.purchases > 0 ? `${r.delivered} of ${r.purchases} delivered` : "No purchases yet";
}

export function Catalog({ config, compact }: { config: PublicConfig; compact?: boolean }) {
  if (compact) {
    return (
      <details className="mt-4 text-xs text-muted">
        <summary>Who the agent pays</summary>
        <ul className="mt-2 space-y-2">
          {config.catalog.map((c) => (
            <li key={c.id}><strong className="text-ink">{c.name}</strong> <span className="mono">{formatUsd(c.lastPriceBase)}</span><br />{c.description} · {record(c.record)}</li>
          ))}
        </ul>
      </details>
    );
  }
  return (
    <section aria-labelledby="payees" className="mt-16">
      <h2 id="payees" className="text-2xl font-semibold tracking-tight">Who the agent pays</h2>
      <p className="mt-2 max-w-2xl text-muted">These are independent companies. The agent has no API keys and pays each of them per request.</p>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {config.catalog.map((c) => (
          <li key={c.id} className="sheet p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><h3 className="break-words font-semibold">{c.name}</h3><div className="mono break-all text-xs text-muted">{c.host}</div></div>
              <div className="mono shrink-0 font-semibold">{formatUsd(c.lastPriceBase)}</div>
            </div>
            <p className="mt-2 text-sm">{c.description}{c.kind === "reasoning" ? " The price shown is typical for one step; each step is quoted separately." : ""}</p>
            <p className="mono mt-2 text-xs text-muted">{record(c.record)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
