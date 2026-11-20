// A person's yes or no when the agent asks before a larger purchase. Only the wallet that owns the run can answer.
import { fail, json, sameOrigin, sessionOwner } from "@/lib/server/auth";
import { getPurchase, getRun, setApproval } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return fail("Cross-site request refused.", 403);
  const owner = sessionOwner(req);
  if (!owner) return fail("Sign in with your wallet first.", 401);
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { purchaseId?: unknown; decision?: unknown };
  if (typeof body.purchaseId !== "string" || (body.decision !== "approved" && body.decision !== "denied")) return fail("Missing purchase or decision.");
  const run = await getRun(id);
  if (!run) return fail("That errand does not exist.", 404);
  if (run.run.owner !== owner || run.run.isHouse) return fail("Only the wallet that owns this errand can approve purchases.", 403);
  const purchase = await getPurchase(body.purchaseId);
  if (!purchase || purchase.run_id !== id) return fail("That purchase is not part of this errand.", 404);
  if (purchase.status !== "awaiting_approval") return fail("That purchase is no longer waiting for an answer.", 409);
  await setApproval(purchase.id, body.decision);
  return json({ ok: true });
}
