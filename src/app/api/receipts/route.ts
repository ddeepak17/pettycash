// Receipts for one wallet. Everything in a receipt is public chain data plus the seller's name and price.
import { fail, json, parseAddress } from "@/lib/server/auth";
import { toReceipts } from "@/lib/server/receipts";
import { purchasesForOwner } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const owner = parseAddress(url.searchParams.get("owner"));
  if (!owner) return fail("That is not a valid wallet address.");
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  const rows = (await purchasesForOwner(owner.toBase58(), limit)).filter((r) => r.pull_sig);
  return json({ receipts: await toReceipts(rows) });
}
