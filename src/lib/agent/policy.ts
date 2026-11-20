// The rule check that runs before any money moves. Pure code, no model involved: the agent can ask for a
// purchase, but it cannot talk its way past these rules, and nothing a seller returns can change them.
//
// These are the limits enforced by our server. The total limit, the expiry and revocation are enforced
// separately by Solana's Allowances program, which would refuse the pull even if this file were bypassed.
import { formatUsd } from "../solana/cluster";
import type { PolicyCheck } from "../types";

export type PolicyInput = {
  offer: { scheme: string; network: string; asset: string; payTo: string; amount: bigint };
  expected: {
    network: string;
    asset: string;
    /** Null when the seller is not in the catalog. */
    seller: null | { name: string; payTo: string; maxPrice: bigint; alwaysAsk?: boolean };
  };
  limits: { perPurchaseMax: bigint; approvalThreshold: bigint; runBudget: bigint };
  state: { spentInRun: bigint; allowanceRemaining: bigint; allowanceExpired: boolean; allowanceMissing?: boolean };
};

export type PolicyDecision = { decision: "allow" | "ask" | "deny"; checks: PolicyCheck[]; reason: string };

type Level = "deny" | "ask";

export function decide(input: PolicyInput): PolicyDecision {
  const { offer, expected, limits, state } = input;
  const checks: PolicyCheck[] = [];
  const failures: { level: Level; detail: string }[] = [];
  const check = (rule: string, pass: boolean, okDetail: string, failDetail: string, level: Level) => {
    checks.push({ rule, pass, detail: pass ? okDetail : failDetail });
    if (!pass) failures.push({ level, detail: failDetail });
  };
  const price = formatUsd(offer.amount);

  check("Fixed price", offer.scheme === "exact", "The seller quoted one fixed price.", "The seller did not quote a fixed price.", "deny");
  check("Right network", offer.network === expected.network, "Payment is on the expected Solana network.", "The seller asked to be paid on a different network.", "deny");
  check("Right token", offer.asset === expected.asset, "Payment is in USDC.", "The seller asked for a token other than USDC.", "deny");
  check("Known seller", expected.seller !== null, expected.seller ? `${expected.seller.name} is on the approved list.` : "", "This seller is not on the approved list.", "deny");
  check("Price above zero", offer.amount > 0n, `The price is ${price}.`, "The quoted price is zero or invalid.", "deny");
  if (expected.seller) {
    check("Same recipient as before", offer.payTo === expected.seller.payTo, "The money goes to the wallet this seller has always used.",
      `${expected.seller.name} asked to be paid at a different wallet than the one on record.`, "ask");
    check("Usual price", offer.amount <= expected.seller.maxPrice, `${price} is within this seller's usual price.`,
      `${price} is more than this seller usually charges (${formatUsd(expected.seller.maxPrice)}).`, "ask");
  }
  check("Per-purchase ceiling", offer.amount <= limits.perPurchaseMax, `${price} is under the ${formatUsd(limits.perPurchaseMax)} ceiling for one purchase.`,
    `${price} is over the ${formatUsd(limits.perPurchaseMax)} ceiling for one purchase.`, "deny");
  check("Budget for this errand", state.spentInRun + offer.amount <= limits.runBudget,
    `${formatUsd(state.spentInRun + offer.amount)} of ${formatUsd(limits.runBudget)} for this errand.`,
    `This would bring the errand to ${formatUsd(state.spentInRun + offer.amount)}, over its ${formatUsd(limits.runBudget)} budget.`, "deny");
  check("Petty cash still exists", !state.allowanceMissing, "The petty cash exists onchain.", "This petty cash no longer exists onchain. It was revoked or has been closed.", "deny");
  if (!state.allowanceMissing) check("Petty cash not expired", !state.allowanceExpired, "The petty cash is still valid.", "The petty cash has expired.", "deny");
  check("Enough petty cash left", offer.amount <= state.allowanceRemaining, `${formatUsd(state.allowanceRemaining)} is left onchain.`,
    `Only ${formatUsd(state.allowanceRemaining)} is left onchain; Solana would refuse this.`, "deny");
  const needsAsk = offer.amount > limits.approvalThreshold || expected.seller?.alwaysAsk === true;
  check("Small enough to buy without asking", !needsAsk, `${price} is under the ${formatUsd(limits.approvalThreshold)} ask-first line.`,
    expected.seller?.alwaysAsk && offer.amount <= limits.approvalThreshold ? "This kind of purchase always needs your approval." : `${price} is over the ${formatUsd(limits.approvalThreshold)} ask-first line.`, "ask");

  const deny = failures.find((f) => f.level === "deny");
  if (deny) return { decision: "deny", checks, reason: deny.detail };
  const ask = failures.find((f) => f.level === "ask");
  if (ask) return { decision: "ask", checks, reason: ask.detail };
  return { decision: "allow", checks, reason: "Within every limit." };
}
