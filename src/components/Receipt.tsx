"use client";
import type React from "react";
import { explorerTx, formatUsd, shortAddress } from "@/lib/solana/cluster";
import type { Cluster, Receipt } from "@/lib/types";
import { useNow } from "@/lib/client/hooks";
import { Spinner, Stamp, ago } from "./ui";

export function VerifyState({ r, cluster }: { r: Receipt; cluster: Cluster }) {
  if (r.mismatch) {
    return (
      <div role="alert" className="mt-3 rounded border-2 border-bad bg-[var(--bad-bg)] p-3 text-sm text-bad">
        <div className="flex items-start gap-3">
          <Stamp bad>Mismatch</Stamp>
          <div><strong>The independent record disagrees with the seller&apos;s quote.</strong><div className="mt-1">{r.mismatch}</div></div>
        </div>
      </div>
    );
  }
  const stamp = r.verified ? (
    <div className="mt-3 flex items-center gap-3">
      <Stamp sub="independently checked" fresh>Verified</Stamp>
      <span className="text-xs text-muted">Verified by QuickNode Streams. The Stream&apos;s own data matches the seller&apos;s quote.</span>
    </div>
  ) : null;
  const note = (tone: "bad" | "muted", title: string, body?: React.ReactNode) => (
    <div className={`mt-3 rounded border p-3 text-sm ${tone === "bad" ? "border-bad bg-[var(--bad-bg)] text-bad" : "border-rule bg-paper"}`}>
      <strong>{title}</strong>{body ? <div className="mt-1">{body}</div> : null}
    </div>
  );
  if (r.status === "refunded") {
    return (<>{note("muted", "Money returned to the wallet", r.refundSignature ? <a className="underline" target="_blank" rel="noopener noreferrer" href={explorerTx(r.refundSignature, cluster)}>View the refund on Solana ↗</a> : "The refund was sent.")}{stamp}</>);
  }
  if (r.status === "failed") return (<>{note("bad", "Did not complete", "The purchase did not go through. Check the transactions below to see whether any money moved.")}{stamp}</>);
  if (r.status === "denied") return note("muted", "Not bought", "No money moved.");
  if (r.status === "awaiting_approval") return <p className="mt-3 text-sm text-muted">Waiting for your approval.</p>;
  if (r.status === "paid" && Date.now() - r.createdAt > 120_000) {
    return (<>{note("bad", "The seller was paid and did not deliver", "The payment went through but nothing came back.")}{stamp}</>);
  }
  if (stamp) return stamp;
  return (
    <p className="mt-3 flex items-center gap-2 text-sm text-muted">
      <span aria-hidden className="pulse inline-block h-2 w-2 rounded-full bg-accent" />
      Paid. Waiting for independent confirmation.
    </p>
  );
}

export function ReceiptCard({ r, cluster, showWallet }: { r: Receipt; cluster: Cluster; showWallet?: boolean }) {
  const now = useNow(15000);
  return (
    <li className="slidein">
      <div className="torn-wrap">
        <article className="torn px-4 pt-4 sm:px-5" aria-label={`Receipt from ${r.seller.name}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="eyebrow">{r.kind === "reasoning" ? "Thinking" : "Purchase"} · {ago(r.createdAt, now)}</div>
              <h3 className="mt-1 break-words font-semibold">{r.seller.name}</h3>
              <div className="mono break-all text-xs text-muted">{r.seller.host}</div>
            </div>
            <div className="mono shrink-0 text-lg font-semibold">{formatUsd(r.amountBase)}</div>
          </div>
          <VerifyState r={r} cluster={cluster} />
          <div className="perf mt-3 flex flex-wrap gap-x-5 gap-y-1 pt-3 text-xs">
            {r.pullSignature ? <a className="underline underline-offset-2" target="_blank" rel="noopener noreferrer" href={explorerTx(r.pullSignature, cluster)}>Money moved from wallet ↗</a> : null}
            {r.paySignature ? <a className="underline underline-offset-2" target="_blank" rel="noopener noreferrer" href={explorerTx(r.paySignature, cluster)}>Seller paid ↗</a> : null}
            {r.refundSignature ? <a className="underline underline-offset-2" target="_blank" rel="noopener noreferrer" href={explorerTx(r.refundSignature, cluster)}>Refund ↗</a> : null}
            {showWallet ? <span className="mono text-muted">from {shortAddress(r.owner)}</span> : null}
            {r.runId ? <a className="underline underline-offset-2" href={`/r/${r.runId}`}>Whole errand</a> : null}
          </div>
        </article>
      </div>
    </li>
  );
}

export function ReceiptList({ receipts, error, cluster, empty, showWallet }: { receipts: Receipt[] | null; error: string | null; cluster: Cluster; empty: string; showWallet?: boolean }) {
  if (error && !receipts) return <p role="alert" className="text-sm text-bad">{error}</p>;
  if (!receipts) return <div className="space-y-3" aria-busy="true"><Spinner label="Loading receipts" /><div className="skeleton h-24" /></div>;
  if (receipts.length === 0) return <p className="rounded border border-dashed border-rule p-5 text-sm text-muted">{empty}</p>;
  return <ul className="space-y-5">{receipts.map((r) => <ReceiptCard key={r.id} r={r} cluster={cluster} showWallet={showWallet} />)}</ul>;
}
