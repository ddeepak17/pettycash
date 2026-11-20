"use client";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import type { PublicConfig, RunDetail } from "@/lib/types";
import * as api from "@/lib/client/api";
import { explainError } from "@/lib/client/errors";
import { foldRun } from "@/lib/client/run";
import { useConfig, useReceipts } from "@/lib/client/hooks";
import { Markdown } from "@/components/ui";
import { ReceiptList } from "@/components/Receipt";
import { RunTape } from "@/components/RunTape";
import { Ribbon, Wordmark } from "@/components/TopBar";
import { ErrorNote, Spinner } from "@/components/ui";

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { config } = useConfig();
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tick, setTick] = useState(Date.now());
  useEffect(() => { api.getRun(id).then(setDetail, (e) => { if ((e as { status?: number }).status === 404) setNotFound(true); else setErr(explainError(e)); }); }, [id]);
  const rc = useReceipts(detail ? { owner: detail.run.owner } : null, id, tick);
  useEffect(() => { if (detail) setTick(Date.now()); }, [detail]);
  const receipts = detail?.receipts.map((r) => rc.receipts?.find((x) => x.id === r.id) ?? r) ?? null;
  const cluster: PublicConfig["cluster"] = config?.cluster ?? "mainnet-beta";
  const run = detail ? foldRun(detail.events) : null;
  return (
    <>
      <Ribbon />
      <header className={`border-b border-rule ${api.MOCK ? "pt-9" : ""}`}><div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3 sm:px-6"><Wordmark /><Link className="btn btn-small" href="/">Try it yourself</Link></div></header>
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-8 sm:px-6">
        <p className="eyebrow">A finished errand, shareable evidence</p>
        {notFound ? (
          <div className="sheet mt-6 p-6" role="status">
            <h1 className="text-2xl font-semibold tracking-tight">We could not find that errand</h1>
            <p className="mt-2 text-muted">The link may be mistyped, or the errand may never have finished starting. Nothing is wrong with your wallet.</p>
            <Link className="btn btn-primary mt-4" href="/">Run an errand</Link>
          </div>
        ) : null}
        {err ? <div className="mt-6"><ErrorNote>{err}</ErrorNote></div> : null}
        {!detail && !err && !notFound ? <div className="mt-6 space-y-3" aria-busy="true"><Spinner label="Loading this errand" /><div className="skeleton h-48" /></div> : null}
        {detail && run ? (
          <>
            <div className="mt-4"><RunTape run={run} cluster={cluster} /></div>
            {detail.run.answer && !run.items.some((i) => i.kind === "answer") ? <div className="sheet mt-6 p-5"><Markdown text={detail.run.answer} /></div> : null}
            <section className="mt-10" aria-labelledby="rc"><h2 id="rc" className="text-xl font-semibold">Receipts</h2>
              <div className="mt-4"><ReceiptList receipts={receipts} error={rc.error} cluster={cluster} empty="No purchases were made in this errand." /></div>
            </section>
          </>
        ) : null}
      </main>
    </>
  );
}
