// Public configuration for the browser. No secrets: addresses, limits, the catalog and the state of the demo petty cash.
import { json } from "@/lib/server/auth";
import { SELLERS, REASONING_SELLER } from "@/lib/agent/catalog";
import { readAllowance } from "@/lib/server/agentWallet";
import { agentPublicKey, cluster, house, limits, network, usdcMint } from "@/lib/server/config";
import { sellerRecords } from "@/lib/server/store";
import { streamIsActive } from "@/lib/server/streamHooks";
import { ALLOWANCES_PROGRAM_ID } from "@/lib/solana/allowances";
import type { PublicConfig } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cached: { at: number; body: PublicConfig } | null = null;

export async function GET() {
  // The same answer serves everyone for a few seconds, so page loads cannot be turned into a stream of chain reads.
  if (cached && Date.now() - cached.at < 4000) return json(cached.body);
  const l = limits();
  const h = house();
  const [live, records, streamActive] = await Promise.all([
    h ? readAllowance(h.delegation).catch(() => null) : Promise.resolve(null),
    sellerRecords().catch(() => ({} as Record<string, { purchases: number; delivered: number }>)),
    streamIsActive().catch(() => false),
  ]);
  const config: PublicConfig = {
    cluster: cluster(), network: network(), rpcUrl: "/api/rpc", usdcMint: usdcMint().toBase58(), agent: agentPublicKey().toBase58(),
    allowancesProgram: ALLOWANCES_PROGRAM_ID.toBase58(),
    limits: { perPurchaseMaxBase: l.perPurchaseMaxBase.toString(), approvalThresholdBase: l.approvalThresholdBase.toString(), maxSteps: l.maxSteps },
    house: h && live && !live.expired
      ? { owner: h.owner.toBase58(), delegation: h.delegation.toBase58(), remainingBase: live.remaining.toString(), perRunBudgetBase: (live.remaining < l.houseRunBudgetBase ? live.remaining : l.houseRunBudgetBase).toString(), expiryTs: Number(live.view.expiryTs) }
      : null,
    streamActive,
    catalog: [
      ...SELLERS.map((s) => ({ id: s.id, name: s.name, host: s.host, kind: s.kind, description: s.description, lastPriceBase: s.lastPriceBase, record: records[s.id] ?? { purchases: 0, delivered: 0 } })),
      { id: REASONING_SELLER.id, name: REASONING_SELLER.name, host: REASONING_SELLER.host, kind: REASONING_SELLER.kind, description: REASONING_SELLER.description, lastPriceBase: REASONING_SELLER.lastPriceBase, record: records.reasoning ?? { purchases: 0, delivered: 0 } },
    ],
  };
  cached = { at: Date.now(), body: config };
  return json(config);
}
