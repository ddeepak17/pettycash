// Start an errand on the public demo petty cash. No wallet and no sign-in: this spends a small allowance from a
// wallet we funded. It cannot cost more than that allowance, because Solana enforces the allowance, not this code.
import { clientIp, fail, sameOrigin } from "@/lib/server/auth";
import { readAllowance } from "@/lib/server/agentWallet";
import { house, limits } from "@/lib/server/config";
import { startRun } from "@/lib/server/runner";
import { withinRateLimit } from "@/lib/server/store";
import { wakeStream } from "@/lib/server/streamHooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail("Cross-site request refused.", 403);
  const h = house();
  if (!h) return fail("The public demo petty cash is switched off right now. Connect your own wallet to try it.", 503);
  const body = (await req.json().catch(() => ({}))) as { task?: unknown };
  const task = typeof body.task === "string" ? body.task.trim() : "";
  if (task.length < 3 || task.length > 300) return fail("Describe the errand in 3 to 300 characters.");
  const l = limits();
  if (!(await withinRateLimit(`house:${clientIp(req)}`, l.houseRunsPerHourPerIp, 3600))) return fail("You have used the public demo a few times this hour. Connect your own wallet to keep going, or come back later.", 429);
  if (!(await withinRateLimit("house:all", l.houseRunsPerHour, 3600))) return fail("The public demo is busy. Connect your own wallet, or try again in a little while.", 429);

  let live;
  try { live = await readAllowance(h.delegation); } catch { return fail("Solana could not be reached just now. Try again in a moment.", 503); }
  if (!live || live.expired || live.remaining < 2000n) return fail("The public demo petty cash is used up for now. Connect your own wallet to try it.", 503);
  const runBudget = live.remaining < l.houseRunBudgetBase ? live.remaining : l.houseRunBudgetBase;
  return startRun({ owner: h.owner, allowance: h.delegation, task, isHouse: true, runBudget, approvalThreshold: l.approvalThresholdBase, onStart: wakeStream }, req.signal);
}
