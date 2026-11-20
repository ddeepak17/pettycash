// Recent receipts from errands run on the public demo petty cash.
import { fail, json } from "@/lib/server/auth";
import { toReceipts } from "@/lib/server/receipts";
import { housePurchases, within } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const receipts = await within(housePurchases(12).then(toReceipts).catch(() => null), 12_000, null);
  if (!receipts) return fail("The receipts could not be loaded just now. Try again in a moment.", 503);
  return json({ receipts });
}
