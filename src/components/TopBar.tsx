"use client";
import Link from "next/link";
import { useState } from "react";
import { shortAddress } from "@/lib/solana/cluster";
import type { PublicConfig } from "@/lib/types";
import { MOCK } from "@/lib/client/api";
import { explainError } from "@/lib/client/errors";
import { useAppWallet } from "@/lib/client/wallet";
import { Modal } from "./Modal";
import { ErrorNote } from "./ui";

export function Ribbon() {
  if (!MOCK) return null;
  return (
    <div role="note" className="fixed inset-x-0 top-0 z-50 flex min-h-9 items-center justify-center bg-ink px-3 py-1 text-center text-[0.8rem] font-semibold tracking-wide text-paper">
      Preview data. Nothing on this page is a real payment.
    </div>
  );
}

export function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight" aria-label="Petty Cash home">
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden><rect x="3" y="2" width="20" height="22" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M7 8h12M7 12h12M7 16h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      <span className="text-lg">Petty Cash</span>
    </Link>
  );
}

export function TopBar({ config }: { config: PublicConfig | null }) {
  const w = useAppWallet();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const real = config?.cluster === "mainnet-beta";
  return (
    <header className={`border-b border-rule ${MOCK ? "pt-9" : ""}`}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <Wordmark />
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {config ? (
            <span className={`mono rounded-full border px-3 py-1 text-xs ${real ? "border-ink bg-ink text-paper" : "border-dashed border-ink"}`}>
              {real ? "Real USDC on Solana mainnet" : "Test money on Solana devnet"}
            </span>
          ) : <span className="skeleton h-6 w-40" />}
          {config ? (
            <span className="mono flex items-center gap-1.5 text-xs text-muted" title="A QuickNode Stream watches the chain and checks every receipt.">
              <span aria-hidden className={`h-2 w-2 rounded-full ${config.streamActive ? "bg-accent" : "bg-bad"}`} />
              {config.streamActive ? "Stream live" : "Stream not delivering"}
            </span>
          ) : null}
          {w.status === "connected" && w.address ? (
            <div className="flex items-center gap-2">
              <span className="mono rounded border border-ink px-2.5 py-1.5 text-xs" title={w.address}>{shortAddress(w.address)}</span>
              <button className="btn btn-small" onClick={() => w.disconnect()}>Disconnect</button>
            </div>
          ) : (
            <button className="btn btn-small" onClick={() => { setErr(null); setOpen(true); }} disabled={w.status === "connecting"}>
              {w.status === "connecting" ? "Connecting…" : "Connect wallet"}
            </button>
          )}
        </div>
      </div>
      <Modal open={open && w.status !== "connected"} onClose={() => setOpen(false)} title="Connect a wallet">
        <p className="text-sm text-muted">Connecting only shares your public address. It does not move money.</p>
        {err ? <div className="mt-3"><ErrorNote>{err}</ErrorNote></div> : null}
        <ul className="mt-4 space-y-2">
          {w.options.length === 0 ? <li className="text-sm">No wallet found in this browser. Install Phantom, Solflare or Backpack, then reload.</li> : null}
          {w.options.map((o) => (
            <li key={o.name}>
              <button
                className="btn w-full justify-between"
                onClick={async () => { setErr(null); try { await w.connect(o.name); setOpen(false); } catch (e) { setErr(explainError(e)); } }}
              >
                <span className="flex items-center gap-2">
                  {o.icon ? <img src={o.icon} alt="" width={22} height={22} /> : null}
                  {o.name}
                </span>
                <span className="text-xs font-normal text-muted">{o.installed ? "Detected" : "Not installed"}</span>
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    </header>
  );
}
