// Public configuration for the browser. No secrets: addresses, limits, the catalog and the state of the demo petty cash.
import { json } from "@/lib/server/auth";
import { SELLERS, REASONING_SELLER } from "@/lib/agent/catalog";
import { readAllowance } from "@/lib/server/agentWallet";
import { agentPublicKey, cluster, house, limits, network, showcaseRunIds, usdcMint } from "@/lib/server/config";
import { sellerRecords, showcaseRuns, within } from "@/lib/server/store";
import { streamIsActive } from "@/lib/server/streamHooks";
import { ALLOWANCES_PROGRAM_ID } from "@/lib/solana/allowances";
import type { PublicConfig } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cached: { at: number; body: PublicConfig } | null = null;
// The demo budget as last read from the chain. If one read fails, the page keeps showing this for a few minutes
// instead of telling visitors the demo is switched off.
let lastHouse: { at: number; value: NonNullable<PublicConfig["house"]> } | null = null;
let lastShowcase: { at: number; rows: PublicConfig["showcase"] } | null = null;

export async function GET() {
  // The same answer serves everyone for a few seconds, so page loads cannot be turned into a stream of chain reads.
  if (cached && Date.now() - cached.at < 4000) return json(cached.body);
  const l = limits();
  const h = house();
  const noRecords = {} as Record<string, { purchases: number; delivered: number }>;
  const [read, records, streamActive, shown] = await Promise.all([
    // { allowance: null } means the chain answered and the account is gone. A plain null means the chain did not answer.
    h ? within(readAllowance(h.delegation).then((allowance) => ({ allowance })).catch(() => null), 8000, null) : Promise.resolve(null),
    within(sellerRecords().catch(() => noRecords), 5000, noRecords),
    within(streamIsActive().catch(() => false), 5000, false),
    lastShowcase && Date.now() - lastShowcase.at < 60_000 ? Promise.resolve(lastShowcase.rows) : within(showcaseRuns(showcaseRunIds()).catch(() => null), 5000, null),
  ]);
  if (shown && shown !== lastShowcase?.rows) lastShowcase = { at: Date.now(), rows: shown };

  let houseView: PublicConfig["house"] = null;
  if (h && read) {
    const live = read.allowance;
    if (live && !live.expired) {
      const now = Math.floor(Date.now() / 1000);
      const expiry = Number(live.view.expiryTs);
      const nextPeriod = live.view.type === "recurring" && live.view.periodSecs > 0n ? Number(live.view.currentPeriodStartTs + live.view.periodSecs) : 0;
      houseView = {
        owner: h.owner.toBase58(), delegation: h.delegation.toBase58(), remainingBase: live.remaining.toString(),
        perRunBudgetBase: (live.remaining < l.houseRunBudgetBase ? live.remaining : l.houseRunBudgetBase).toString(), expiryTs: expiry,
        canRun: live.remaining >= l.houseMinRunBase,
        ...(live.view.type === "recurring" ? { perPeriodBase: live.view.amountPerPeriod.toString() } : {}),
        ...(nextPeriod > now && (expiry === 0 || nextPeriod < expiry) ? { refillsAt: nextPeriod } : {}),
      };
      lastHouse = { at: Date.now(), value: houseView };
    } else lastHouse = null;
  } else if (h && lastHouse && Date.now() - lastHouse.at < 10 * 60_000) houseView = lastHouse.value;

  const config: PublicConfig = {
    cluster: cluster(), network: network(), rpcUrl: "/api/rpc", usdcMint: usdcMint().toBase58(), agent: agentPublicKey().toBase58(),
    allowancesProgram: ALLOWANCES_PROGRAM_ID.toBase58(),
    limits: { perPurchaseMaxBase: l.perPurchaseMaxBase.toString(), approvalThresholdBase: l.approvalThresholdBase.toString(), maxSteps: l.maxSteps },
    house: houseView,
    showcase: shown ?? lastShowcase?.rows ?? [],
    streamActive,
    catalog: [
      ...SELLERS.map((s) => ({ id: s.id, name: s.name, host: s.host, kind: s.kind, description: s.summary, lastPriceBase: s.lastPriceBase, record: records[s.id] ?? { purchases: 0, delivered: 0 } })),
      { id: REASONING_SELLER.id, name: REASONING_SELLER.name, host: REASONING_SELLER.host, kind: REASONING_SELLER.kind, description: REASONING_SELLER.summary, lastPriceBase: "4000", record: records.reasoning ?? { purchases: 0, delivered: 0 } },
    ],
  };
  cached = { at: Date.now(), body: config };
  return json(config);
}
