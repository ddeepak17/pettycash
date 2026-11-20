// Starts one agent run and streams its timeline to the browser as newline-delimited JSON.
// Every event is also stored, so a finished run can be replayed on its public page.
import { PublicKey } from "@solana/web3.js";
import { after } from "next/server";
import { runAgent } from "../agent/loop";
import { settleUnresolved } from "../agent/purchase";
import type { RunEvent } from "../types";
import { readAllowance } from "./agentWallet";
import { cluster, limits as serverLimits, reasoning } from "./config";
import { addEvent, createRun, finishRun } from "./store";

export type StartRun = {
  owner: PublicKey;
  allowance: PublicKey;
  task: string;
  isHouse: boolean;
  runBudget: bigint;
  approvalThreshold: bigint;
  /** Called once when the run starts, for example to switch the Stream on. Failures are ignored. */
  onStart?: () => Promise<unknown>;
};

export async function startRun(o: StartRun, requestSignal: AbortSignal): Promise<Response> {
  const l = serverLimits();
  const live = await readAllowance(o.allowance);
  const runId = await createRun({ owner: o.owner.toBase58(), delegation: o.allowance.toBase58(), cluster: cluster(), task: o.task, model: reasoning().model, isHouse: o.isHouse });
  const encoder = new TextEncoder();
  const started = Date.now();
  let seq = 0;
  // Keeps the function alive until the run and its bookkeeping are finished, even if the browser disconnects.
  let finished!: () => void;
  const done = new Promise<void>((resolve) => { finished = resolve; });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = async (e: RunEvent) => {
        const n = seq++;
        if (open) { try { controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`)); } catch { open = false; } }
        await addEvent(runId, n, e).catch(() => {});
      };
      try {
        void o.onStart?.().catch(() => {});
        await emit({ type: "run_started", runId, owner: o.owner.toBase58(), delegation: o.allowance.toBase58(), task: o.task, runBudgetBase: o.runBudget.toString(), remainingBase: (live?.remaining ?? 0n).toString(), at: started });
        // The run is NOT tied to the browser connection: once money may be in flight we finish the purchase and the
        // bookkeeping even if the person closes the tab. Only a new step is skipped after a disconnect.
        const result = await runAgent({
          runId, owner: o.owner, allowance: o.allowance, task: o.task, canAsk: !o.isHouse,
          limits: { perPurchaseMax: l.perPurchaseMaxBase, approvalThreshold: o.approvalThreshold, runBudget: o.runBudget, approvalWaitMs: l.approvalWaitMs, maxSteps: l.maxSteps },
          emit, signal: requestSignal,
        });
        await finishRun(runId, { status: result.status, answer: result.answer, spentBase: result.spent });
        await emit({ type: "run_finished", runId, status: result.status, spentBase: result.spent.toString(), purchases: result.purchases, ms: Date.now() - started });
      } catch (e) {
        await finishRun(runId, { status: "failed", answer: null, spentBase: 0n }).catch(() => {});
        await emit({ type: "error", message: "Something went wrong on our side and the errand stopped. Any money that was moved and not spent is returned automatically." });
        console.error("run failed", runId, e instanceof Error ? e.message : e);
      } finally {
        if (open) { try { controller.close(); } catch { /* already closed */ } }
        finished();
      }
    },
  });

  // After the response: settle anything left unclear (return unspent money, record late payments).
  after(async () => { await done; await settleUnresolved(o.owner.toBase58()).catch(() => {}); });

  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no", "x-run-id": runId } });
}
