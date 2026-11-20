// Start an errand on your own petty cash. Requires a signed-in wallet that owns the petty cash.
import { fail, parseAddress, sameOrigin, sessionOwner } from "@/lib/server/auth";
import { readAllowance } from "@/lib/server/agentWallet";
import { agentPublicKey, limits, usdcMint } from "@/lib/server/config";
import { startRun } from "@/lib/server/runner";
import { activeRunFor, withinRateLimit } from "@/lib/server/store";
import { wakeStream } from "@/lib/server/streamHooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const amount = (v: unknown): bigint | null => (typeof v === "string" && /^\d{1,12}$/.test(v) ? BigInt(v) : null);

export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail("Cross-site request refused.", 403);
  const ownerAddress = sessionOwner(req);
  if (!ownerAddress) return fail("Sign in with your wallet first.", 401);
  const body = (await req.json().catch(() => ({}))) as { task?: unknown; delegation?: unknown; runBudgetBase?: unknown; approvalThresholdBase?: unknown };
  const task = typeof body.task === "string" ? body.task.trim() : "";
  if (task.length < 3 || task.length > 500) return fail("Describe the errand in 3 to 500 characters.");
  const allowance = parseAddress(body.delegation);
  if (!allowance) return fail("Choose a petty cash to spend from.");
  const owner = parseAddress(ownerAddress)!;

  let live;
  try { live = await readAllowance(allowance); } catch { return fail("Solana could not be reached just now. Try again in a moment.", 503); }
  if (!live) return fail("That petty cash no longer exists onchain. Set aside a new one.", 409);
  if (!live.view.delegator.equals(owner)) return fail("That petty cash belongs to a different wallet.", 403);
  if (!live.view.delegatee.equals(agentPublicKey()) || !live.view.mint.equals(usdcMint())) return fail("That petty cash was not set aside for this agent.", 400);
  if (live.expired) return fail("That petty cash has expired. Set aside a new one.", 409);
  if (live.remaining === 0n) return fail("That petty cash is used up. Set aside a new one.", 409);
  if (await activeRunFor(owner.toBase58())) return fail("An errand is already running for this wallet. Wait for it to finish.", 409);
  if (!(await withinRateLimit(`run:${owner.toBase58()}`, 30, 3600))) return fail("That is a lot of errands in one hour. Try again later.", 429);

  const l = limits();
  const requestedBudget = amount(body.runBudgetBase) ?? l.runBudgetBase;
  const runBudget = [requestedBudget, l.runBudgetBase, live.remaining].reduce((a, b) => (a < b ? a : b));
  const requestedAsk = amount(body.approvalThresholdBase) ?? l.approvalThresholdBase;
  const approvalThreshold = requestedAsk < l.approvalThresholdBase ? requestedAsk : l.approvalThresholdBase;
  return startRun({ owner, allowance, task, isHouse: false, runBudget, approvalThreshold, onStart: wakeStream }, req.signal);
}
