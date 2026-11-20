// One errand with its timeline and receipts. Errands on the public demo petty cash are public; an errand on a
// person's own petty cash is shown only to the wallet that ran it.
import { fail, json, sessionOwner } from "@/lib/server/auth";
import { toReceipts } from "@/lib/server/receipts";
import { getRun, purchasesForRun } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const found = await getRun(id);
  if (!found) return fail("That errand does not exist.", 404);
  if (!found.run.isHouse && sessionOwner(req) !== found.run.owner) return fail("This errand is private to the wallet that ran it.", 403);
  const receipts = await toReceipts((await purchasesForRun(id)).filter((r) => r.pull_sig));
  return json({ run: found.run, events: found.events, receipts });
}
