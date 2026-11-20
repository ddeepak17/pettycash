// What the agent's key can do onchain: pull an exact amount under a petty cash, give money back, and (for the
// "test the limit" button) ask the chain to refuse an oversized pull. Nothing here can move more than the
// Allowances program permits: the program, not this file, enforces the limit.
import { ComputeBudgetProgram, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction } from "@solana/spl-token";
import { ALLOWANCES_ERRORS, allowancesErrorCode, ata, ixTransferFixed, ixTransferRecurring, readDelegation, readSaInitId, subscriptionAuthorityPda, ALLOWANCES_PROGRAM_ID, type DelegationView } from "../solana/allowances";
import { USDC_DECIMALS } from "../solana/cluster";
import type { Allowance, AllowanceState, ProofResult } from "../types";
import { agentKeypair, agentPublicKey, priorityMicroLamports, usdcMint } from "./config";
import { read, sendAndConfirm, simulate, TransactionFailed } from "./rpc";

export class ChainRefused extends Error {
  constructor(public code: number | null, public name: string, public plain: string, public signature: string | null, public logs: string[]) { super(plain); }
}

const budget = (units: number): TransactionInstruction[] => [
  ComputeBudgetProgram.setComputeUnitLimit({ units }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityMicroLamports() }),
];

function toChainRefused(e: unknown): ChainRefused | null {
  if (!(e instanceof TransactionFailed)) return null;
  const code = allowancesErrorCode(`${JSON.stringify(e.detail)} ${e.logs.join(" ")}`);
  const touchedProgram = e.logs.some((l) => l.includes(ALLOWANCES_PROGRAM_ID.toBase58()));
  if (code !== null && ALLOWANCES_ERRORS[code]) return new ChainRefused(code, ALLOWANCES_ERRORS[code].name, ALLOWANCES_ERRORS[code].plain, e.signature, e.logs);
  if (touchedProgram || code !== null) return new ChainRefused(code, "refused", "Solana's Allowances program refused this pull.", e.signature, e.logs);
  // The allowance account does not exist (revoked or never created): the program cannot even load it.
  if (/AccountNotFound|InvalidAccountData|IncorrectProgramId|InvalidAccountOwner|invalid account data|AccountOwnedByWrongProgram/i.test(`${JSON.stringify(e.detail)} ${e.logs.join(" ")}`))
    return new ChainRefused(null, "allowanceMissing", "This petty cash no longer exists onchain. It was revoked or has been closed.", e.signature, e.logs);
  return null;
}

export type LiveAllowance = { address: PublicKey; view: DelegationView; remaining: bigint; expired: boolean };

/** Reads one petty cash straight from the chain. Returns null when the account is gone (revoked). */
export async function readAllowance(address: PublicKey): Promise<LiveAllowance | null> {
  const info = await read((c) => c.getAccountInfo(address, "confirmed"));
  if (!info || !info.owner.equals(ALLOWANCES_PROGRAM_ID)) return null;
  const view = readDelegation(info.data);
  if (!view) return null;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const expired = view.expiryTs !== 0n && view.expiryTs <= now;
  let remaining = view.type === "fixed" ? view.remaining : view.remainingInPeriod;
  // A recurring allowance resets when a new period starts; the account only updates on the next pull.
  if (view.type === "recurring" && view.periodSecs > 0n && now >= view.currentPeriodStartTs + view.periodSecs) remaining = view.amountPerPeriod;
  return { address, view, remaining: expired ? 0n : remaining, expired };
}

/** Everything the app needs to know about a wallet: balances, whether the one-time setup is done, and its petty cashes for this agent. */
export async function readAllowanceState(owner: PublicKey): Promise<AllowanceState> {
  const mint = usdcMint();
  const agent = agentPublicKey();
  const [sol, token, sa, accounts] = await Promise.all([
    read((c) => c.getBalance(owner, "confirmed")),
    read((c) => c.getTokenAccountBalance(ata(owner, mint), "confirmed")).then((r) => r.value.amount).catch(() => "0"),
    read((c) => c.getAccountInfo(subscriptionAuthorityPda(owner, mint), "confirmed")),
    read((c) => c.getProgramAccounts(ALLOWANCES_PROGRAM_ID, { commitment: "confirmed", filters: [{ memcmp: { offset: 3, bytes: owner.toBase58() } }, { memcmp: { offset: 35, bytes: agent.toBase58() } }] })),
  ]);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const allowances: Allowance[] = [];
  for (const a of accounts) {
    const view = readDelegation(a.account.data);
    if (!view || !view.mint.equals(mint)) continue;
    const expired = view.expiryTs !== 0n && view.expiryTs <= now;
    let remaining = view.type === "fixed" ? view.remaining : view.remainingInPeriod;
    if (view.type === "recurring" && view.periodSecs > 0n && now >= view.currentPeriodStartTs + view.periodSecs) remaining = view.amountPerPeriod;
    allowances.push({
      address: a.pubkey.toBase58(), nonce: "", type: view.type, remainingBase: (expired ? 0n : remaining).toString(),
      ...(view.type === "recurring" ? { amountPerPeriodBase: view.amountPerPeriod.toString(), periodSecs: Number(view.periodSecs) } : {}),
      expiryTs: Number(view.expiryTs), expired, rentPayer: view.payer.toBase58(),
    });
  }
  allowances.sort((a, b) => Number(a.expired) - Number(b.expired) || b.expiryTs - a.expiryTs);
  return {
    owner: owner.toBase58(), usdcBalanceBase: token, solLamports: String(sol),
    authorityInitialized: !!sa && sa.owner.equals(ALLOWANCES_PROGRAM_ID), authorityInitId: sa && sa.owner.equals(ALLOWANCES_PROGRAM_ID) ? readSaInitId(sa.data).toString() : null, allowances,
  };
}

const pullIx = (a: LiveAllowance, amount: bigint) => {
  const mint = usdcMint();
  const agent = agentPublicKey();
  const p = { delegation: a.address, delegator: a.view.delegator, delegatee: agent, mint, amount, destinationTokenAccount: ata(agent, mint) };
  return a.view.type === "fixed" ? ixTransferFixed(p) : ixTransferRecurring(p);
};

/** Moves exactly `amount` from the owner's wallet to the agent under the petty cash. Throws ChainRefused when the program says no. */
export async function pull(allowance: LiveAllowance, amount: bigint): Promise<{ signature: string; slot: number; ms: number }> {
  const agent = agentKeypair();
  const mint = usdcMint();
  try {
    return await sendAndConfirm(
      [...budget(90_000), createAssociatedTokenAccountIdempotentInstruction(agent.publicKey, ata(agent.publicKey, mint), agent.publicKey, mint), pullIx(allowance, amount)],
      agent.publicKey, [agent],
    );
  } catch (e) {
    throw toChainRefused(e) ?? e;
  }
}

/** Returns `amount` from the agent to the owner's own token account. Used when a purchase did not complete. */
export async function refund(owner: PublicKey, amount: bigint): Promise<{ signature: string; slot: number; ms: number }> {
  const agent = agentKeypair();
  const mint = usdcMint();
  return sendAndConfirm(
    [...budget(40_000), createTransferCheckedInstruction(ata(agent.publicKey, mint), mint, ata(owner, mint), agent.publicKey, amount, USDC_DECIMALS)],
    agent.publicKey, [agent],
  );
}

export const agentTokenBalance = async (): Promise<bigint> =>
  BigInt(await read((c) => c.getTokenAccountBalance(ata(agentPublicKey(), usdcMint()), "confirmed")).then((r) => r.value.amount).catch(() => "0"));

/** Asks the chain for one base unit more than the petty cash has left. With `send`, the refusal is recorded onchain as a failed transaction anyone can open. */
export async function proveOverspend(address: PublicKey, send: boolean): Promise<ProofResult> {
  const allowance = await readAllowance(address);
  const agent = agentKeypair();
  if (!allowance) {
    return { attemptedBase: "1", remainingBase: "0", refused: true, code: null, name: "allowanceMissing", plain: "This petty cash no longer exists onchain, so nothing can be pulled from it.", signature: null, logs: [] };
  }
  const attempt = allowance.remaining + 1n;
  const ixs = [...budget(90_000), pullIx(allowance, attempt)];
  const result = (refused: boolean, code: number | null, name: string, plain: string, signature: string | null, logs: string[]): ProofResult =>
    ({ attemptedBase: attempt.toString(), remainingBase: allowance.remaining.toString(), refused, code, name, plain, signature, logs: logs.slice(-12) });
  if (!send) {
    const sim = await simulate(ixs, agent.publicKey, [agent]);
    if (!sim.err) return result(false, null, "notRefused", "The chain did not refuse this pull. That should never happen; please report it.", null, sim.logs);
    const code = allowancesErrorCode(`${JSON.stringify(sim.err)} ${sim.logs.join(" ")}`);
    const known = code !== null ? ALLOWANCES_ERRORS[code] : undefined;
    return result(true, code, known?.name ?? "refused", known?.plain ?? "Solana's Allowances program refused this pull.", null, sim.logs);
  }
  try {
    const sent = await sendAndConfirm(ixs, agent.publicKey, [agent], { skipPreflight: true });
    return result(false, null, "notRefused", "The chain did not refuse this pull. That should never happen; please report it.", sent.signature, []);
  } catch (e) {
    const refused = toChainRefused(e);
    if (refused) return result(true, refused.code, refused.name, refused.plain, refused.signature, refused.logs);
    throw e;
  }
}
