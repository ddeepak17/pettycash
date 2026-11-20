// Thin wrappers around the QuickNode Stream controls, so a Stream problem can never break a purchase.
import { ensureStreamActive, streamStatus } from "../stream/control";

/** Switches the Stream on if it is paused. Called when an errand starts. Errors are swallowed: receipts simply stay unverified. */
export async function wakeStream(): Promise<void> {
  try { await ensureStreamActive(); } catch (e) { console.error("stream wake failed:", e instanceof Error ? e.message : e); }
}

let cached: { at: number; active: boolean } | null = null;
/** Whether the Stream is delivering right now, as QuickNode reports it. Cached for a few seconds. */
export async function streamIsActive(): Promise<boolean> {
  if (cached && Date.now() - cached.at < 10_000) return cached.active;
  const s = await streamStatus().catch(() => null);
  cached = { at: Date.now(), active: s?.active === true };
  return cached.active;
}
