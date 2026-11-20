// Thin wrappers around the QuickNode Stream controls, so a Stream problem can never break a purchase.
// The Stream is billed per processed block, so it runs only while errands need it: an errand switches it on,
// and it is paused again after a few idle minutes.
import { ensureStreamActive, pauseStreamIfIdle, streamStatus } from "../stream/control";

/** Switches the Stream on if it is paused. Called when an errand starts. Errors are swallowed: receipts simply stay unverified. */
export async function wakeStream(): Promise<void> {
  try { await ensureStreamActive(); cached = null; } catch (e) { console.error("stream wake failed:", e instanceof Error ? e.message : e); }
}

/** Pauses the Stream when no errand has needed it for `minutes`. Safe to call often. */
export async function restStreamIfIdle(minutes = Number(process.env.STREAM_IDLE_MINUTES ?? 2)): Promise<{ paused: boolean } | null> {
  try { const r = await pauseStreamIfIdle(minutes); cached = null; return { paused: r.paused }; } catch (e) { console.error("stream idle check failed:", e instanceof Error ? e.message : e); return null; }
}

let cached: { at: number; active: boolean } | null = null;
/** Whether the Stream is delivering right now, as QuickNode reports it. Cached for a few seconds. */
export async function streamIsActive(): Promise<boolean> {
  if (cached && Date.now() - cached.at < 10_000) return cached.active;
  const s = await streamStatus().catch(() => null);
  cached = { at: Date.now(), active: s?.active === true };
  return cached.active;
}
