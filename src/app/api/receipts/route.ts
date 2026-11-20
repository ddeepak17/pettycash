// Receipts for one wallet. Everything in a receipt is public chain data plus the seller's name and price.
import { fail, json, parseAddress } from "@/lib/server/auth";
import { toReceipts } from "@/lib/server/receipts";
import { purchasesForOwner, within } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const owner = parseAddress(url.searchParams.get("owner"));
  if (!owner) return fail("That is not a valid wallet address.");
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  const receipts = await within(purchasesForOwner(owner.toBase58(), limit).then((rows) => toReceipts(rows.filter((r) => r.pull_sig))).catch(() => null), 12_000, null);
  if (!receipts) return fail("The receipts could not be loaded just now. Try again in a moment.", 503);
  return json({ receipts });
}
