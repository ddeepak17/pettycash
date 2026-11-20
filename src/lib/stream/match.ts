// What the stream filter reports, and the rule that turns it into "verified". Pure functions: no I/O.
//
// The filter (infra/quicknode/filter.js) reports, for every transaction that names the agent's key, the net
// token change per owner wallet and mint. A receipt is verified only from those numbers, never from what the
// agent or the seller said happened.
import type { StreamProof } from "../types";
import { CLUSTERS, formatUsd } from "../solana/cluster";

export type Movement = { owner: string; mint: string; deltaBase: string };

/** One transaction exactly as the filter emits it. */
export type StreamMatch = {
  signature: string;
  slot: number;
  blockTime: number | null;
  ok: boolean;
  /** The chain's error object when the transaction failed, otherwise null. */
  err: unknown;
  feePayer: string | null;
  version: string | number | null;
  /** Every program invoked, top level and inner. */
  programs: string[];
  /** True when the Subscriptions and Allowances program was invoked. */
  allowances: boolean;
  /** First data byte of each instruction sent to that program (4 = fixed pull, 5 = recurring pull). */
  allowanceIxs: number[];
  memos: string[];
  movements: Movement[];
  /** Set by the filter when it could not read the token balances; movements is then empty. */
  balanceError?: boolean;
};

export type ParsedDelivery = {
  matches: StreamMatch[];
  streamId: string | null;
  network: string | null;
  /** Entries that looked like a transaction but failed validation. They are never stored. */
  skipped: number;
};

const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNED_INT = /^-?\d{1,40}$/;
const ZERO = BigInt(0);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function toMovements(v: unknown): Movement[] | null {
  if (!Array.isArray(v)) return null;
  const out: Movement[] = [];
  for (const m of v) {
    if (!isObject(m) || typeof m.owner !== "string" || typeof m.mint !== "string" || typeof m.deltaBase !== "string") return null;
    if (!ADDRESS.test(m.owner) || !ADDRESS.test(m.mint) || !SIGNED_INT.test(m.deltaBase)) return null;
    out.push({ owner: m.owner, mint: m.mint, deltaBase: m.deltaBase });
  }
  return out;
}

/** Validates one filter object. Anything the verification depends on must be well formed, or the entry is rejected. */
export function toStreamMatch(v: unknown): StreamMatch | null {
  if (!isObject(v)) return null;
  if (typeof v.signature !== "string" || !SIGNATURE.test(v.signature)) return null;
  if (typeof v.slot !== "number" || !Number.isSafeInteger(v.slot) || v.slot < 0) return null;
  if (typeof v.ok !== "boolean") return null;
  const blockTime = v.blockTime === null || v.blockTime === undefined ? null : v.blockTime;
  if (blockTime !== null && (typeof blockTime !== "number" || !Number.isSafeInteger(blockTime))) return null;
  const movements = toMovements(v.movements);
  if (!movements) return null;
  const match: StreamMatch = {
    signature: v.signature,
    slot: v.slot,
    blockTime,
    ok: v.ok,
    err: v.err ?? null,
    feePayer: typeof v.feePayer === "string" ? v.feePayer : null,
    version: typeof v.version === "string" || typeof v.version === "number" ? v.version : null,
    programs: strings(v.programs),
    allowances: v.allowances === true,
    allowanceIxs: Array.isArray(v.allowanceIxs) ? v.allowanceIxs.filter((x): x is number => typeof x === "number" && Number.isInteger(x)) : [],
    memos: strings(v.memos),
    movements,
  };
  if (v.balanceError === true) match.balanceError = true;
  return match;
}

/**
 * Reads a webhook body after JSON.parse. The filter returns { pettycash, agent, network, streamId, matches: [...] }
 * and QuickNode posts the filter's return value as the body. To stay correct if that ever changes, this also accepts
 * a bare transaction object, an array of them, and either of those wrapped as { data: ..., metadata: {...} }.
 */
export function parseStreamBody(body: unknown): ParsedDelivery {
  const out: ParsedDelivery = { matches: [], streamId: null, network: null, skipped: 0 };
  const seen = new Set<string>();
  const walk = (v: unknown, depth: number): void => {
    if (depth > 6 || v === null || v === undefined) return;
    if (Array.isArray(v)) { for (const item of v) walk(item, depth + 1); return; }
    if (!isObject(v)) return;
    if ("signature" in v) {
      const match = toStreamMatch(v);
      if (!match) out.skipped++;
      else if (!seen.has(match.signature)) { seen.add(match.signature); out.matches.push(match); }
      return;
    }
    const metadata = isObject(v.metadata) ? v.metadata : {};
    const streamId = typeof v.streamId === "string" ? v.streamId : typeof metadata.stream_id === "string" ? metadata.stream_id : null;
    const network = typeof v.network === "string" ? v.network : typeof metadata.network === "string" ? metadata.network : null;
    if (streamId && !out.streamId) out.streamId = streamId;
    if (network && !out.network) out.network = network;
    for (const key of ["matches", "data", "result"]) if (key in v) walk(v[key], depth + 1);
  };
  walk(body, 0);
  return out;
}

// ── The verification rule ────────────────────────────────────────────────────

/** What should have happened, taken from the seller's quote (payment) or the allowance pull we requested. */
export type ExpectedTransfer =
  | { kind: "payment"; agent: string; payTo: string; mint: string; amountBase: string }
  | { kind: "pull"; agent: string; owner: string; mint: string; amountBase: string };

export type ReceiptCheck = { verified: boolean; mismatch: string | null };

const USDC_MINTS = new Set(Object.values(CLUSTERS).map((c) => c.usdcMint));
const money = (base: bigint, mint: string) => (USDC_MINTS.has(mint) ? formatUsd(base) : `${base.toString()} base units of the token`);

/** Net change of one owner's holdings of one mint; null when a number cannot be read. */
function netChange(movements: StreamProof["movements"], owner: string, mint: string): bigint | null {
  let total = ZERO;
  for (const m of movements) {
    if (m.owner !== owner || m.mint !== mint) continue;
    if (typeof m.deltaBase !== "string" || !SIGNED_INT.test(m.deltaBase)) return null;
    total += BigInt(m.deltaBase);
  }
  return total;
}

/**
 * Compares what the Stream delivered with what was expected.
 *
 * payment: verified only when the transaction succeeded, the seller's wallet (payTo) gained exactly amountBase of
 *          the mint, and the agent's wallet lost exactly amountBase of it.
 * pull:    verified only when the transaction succeeded, the owner's wallet lost exactly amountBase of the mint and
 *          the agent's wallet gained exactly amountBase of it.
 *
 * Movements of other wallets or other tokens in the same transaction do not change the result.
 * No proof (the Stream has not delivered the transaction) is "not verified" without a mismatch: nothing disagrees yet.
 */
export function checkReceipt(proof: StreamProof | null | undefined, expected: ExpectedTransfer): ReceiptCheck {
  if (!proof) return { verified: false, mismatch: null };
  const fail = (mismatch: string): ReceiptCheck => ({ verified: false, mismatch });

  if (!/^\d{1,40}$/.test(expected.amountBase) || BigInt(expected.amountBase) <= ZERO) return fail("The expected amount is not a positive whole number, so there is nothing to check against.");
  const amount = BigInt(expected.amountBase);
  const payment = expected.kind === "payment";
  const from = payment ? expected.agent : expected.owner;
  const to = payment ? expected.payTo : expected.agent;
  const payer = payment ? "The agent" : "The owner's wallet";
  const receiver = payment ? "The seller" : "The agent";
  if (from === to) return fail("The paying wallet and the receiving wallet are the same, so no money can have moved between them.");

  if (proof.ok !== true) return fail("The transaction failed on chain, so no money moved.");
  if (!Array.isArray(proof.movements)) return fail("The Stream's record of this transaction has no token movements to check.");

  const gained = netChange(proof.movements, to, expected.mint);
  const change = netChange(proof.movements, from, expected.mint);
  if (gained === null || change === null) return fail("The Stream's record of this transaction could not be read.");
  const lost = -change;

  if (gained !== amount) {
    if (gained > ZERO) return fail(`${receiver} received ${money(gained, expected.mint)}, but the expected amount was ${money(amount, expected.mint)}.`);
    if (gained < ZERO) return fail(`${receiver} ended up with less of the token, not more.`);
    const otherToken = proof.movements.some((m) => m.owner === to && m.mint !== expected.mint && /^\d+$/.test(m.deltaBase) && BigInt(m.deltaBase) > ZERO);
    if (otherToken) return fail(`${receiver} was paid in a different token than the expected one.`);
    const elsewhere = proof.movements.some((m) => m.owner !== to && m.owner !== from && m.mint === expected.mint && /^\d+$/.test(m.deltaBase) && BigInt(m.deltaBase) > ZERO);
    if (elsewhere) return fail(`The money went to a different wallet, not to ${receiver.toLowerCase()}.`);
    return fail(`${receiver} received nothing in this transaction.`);
  }
  if (lost !== amount) {
    if (lost > ZERO) return fail(`${payer} paid ${money(lost, expected.mint)}, but the expected amount was ${money(amount, expected.mint)}.`);
    return fail(`${payer} did not pay this amount: the money came from somewhere else.`);
  }
  return { verified: true, mismatch: null };
}
