// Recent receipts from errands run on the public demo petty cash.
import { json } from "@/lib/server/auth";
import { toReceipts } from "@/lib/server/receipts";
import { housePurchases } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return json({ receipts: await toReceipts(await housePurchases(12)) });
}
