// Solana Subscriptions & Allowances program (De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44):
// instruction builders, PDA derivations and account readers.
//
// Layouts follow the Codama IDL of solana-foundation/subscriptions (v0.5.0, the mainnet build) and are
// exercised against that exact mainnet binary by scripts/verify-allowances-local.ts.
// Petty Cash deploys no program of its own: every limit below is enforced by this program.
import { Buffer } from "buffer";
import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

export const ALLOWANCES_PROGRAM_ID = new PublicKey("De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44");

/** Custom program errors we surface to people in plain words. */
export const ALLOWANCES_ERRORS: Record<number, { name: string; plain: string }> = {
  113: { name: "notEnoughAccountKeys", plain: "The transaction was missing an account the program requires." },
  128: { name: "delegationExpired", plain: "This petty cash has expired." },
  130: { name: "unauthorized", plain: "This key is not allowed to spend from this petty cash." },
  135: { name: "delegationAlreadyExists", plain: "A petty cash with this number already exists." },
  136: { name: "staleSubscriptionAuthority", plain: "The wallet's spending authority was reset; this petty cash is no longer valid." },
  300: { name: "amountExceedsLimit", plain: "The amount is more than what is left in this petty cash." },
  301: { name: "fixedDelegationExpiryInPast", plain: "The expiry time is in the past." },
  302: { name: "fixedDelegationAmountZero", plain: "The amount must be more than zero." },
  400: { name: "amountExceedsPeriodLimit", plain: "The amount is more than what is left for this period." },
  407: { name: "delegationNotStarted", plain: "This petty cash has not started yet." },
};

const text = (s: string) => new TextEncoder().encode(s);
export const u64le = (n: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, n, true); return b; };
export const i64le = (n: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, n, true); return b; };
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const view = (d: Uint8Array) => new DataView(d.buffer, d.byteOffset, d.byteLength);
const readU64 = (d: Uint8Array, o: number) => view(d).getBigUint64(o, true);
const readI64 = (d: Uint8Array, o: number) => view(d).getBigInt64(o, true);

const meta = (pubkey: PublicKey, isWritable = false, isSigner = false): AccountMeta => ({ pubkey, isWritable, isSigner });
const ix = (keys: AccountMeta[], data: Uint8Array) => new TransactionInstruction({ programId: ALLOWANCES_PROGRAM_ID, keys, data: Buffer.from(data) });
const pda = (seeds: Uint8Array[]) => PublicKey.findProgramAddressSync(seeds, ALLOWANCES_PROGRAM_ID)[0];

// ── PDAs ────────────────────────────────────────────────────────────────────
/** One per (wallet, mint). The program makes this PDA the token account's single SPL delegate. */
export const subscriptionAuthorityPda = (user: PublicKey, mint: PublicKey) => pda([text("SubscriptionAuthority"), user.toBytes(), mint.toBytes()]);
/** One per (wallet, spender, nonce): the capped allowance itself. */
export const delegationPda = (sa: PublicKey, delegator: PublicKey, delegatee: PublicKey, nonce: bigint) =>
  pda([text("delegation"), sa.toBytes(), delegator.toBytes(), delegatee.toBytes(), u64le(nonce)]);
export const eventAuthorityPda = () => pda([text("event_authority")]);
export const ata = (owner: PublicKey, mint: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true);

// ── Owner instructions (signed in the owner's own wallet) ────────────────────
/** ix 0. Makes the SubscriptionAuthority PDA the delegate of the owner's token account. Needed once per wallet and mint. */
export function ixInitSubscriptionAuthority(owner: PublicKey, mint: PublicKey, payer?: PublicKey) {
  const keys = [meta(owner, true, true), meta(subscriptionAuthorityPda(owner, mint), true), meta(mint), meta(ata(owner, mint), true), meta(SystemProgram.programId), meta(TOKEN_PROGRAM_ID)];
  if (payer) keys.push(meta(payer, true, true));
  return ix(keys, Uint8Array.of(0));
}

/** ix 1. Fixed allowance: at most `amount` in total, until `expiryTs` (0 = no expiry). */
export function ixCreateFixedDelegation(p: { owner: PublicKey; mint: PublicKey; delegatee: PublicKey; nonce: bigint; amount: bigint; expiryTs: bigint; initId: bigint; payer?: PublicKey }) {
  const sa = subscriptionAuthorityPda(p.owner, p.mint);
  const keys = [meta(p.owner, true, true), meta(sa), meta(delegationPda(sa, p.owner, p.delegatee, p.nonce), true), meta(p.delegatee), meta(SystemProgram.programId)];
  if (p.payer) keys.push(meta(p.payer, true, true));
  return ix(keys, concat(Uint8Array.of(1), u64le(p.nonce), u64le(p.amount), i64le(p.expiryTs), i64le(p.initId)));
}

/** ix 2. Recurring allowance: at most `amountPerPeriod` every `periodSecs`, from `startTs` until `expiryTs`. */
export function ixCreateRecurringDelegation(p: { owner: PublicKey; mint: PublicKey; delegatee: PublicKey; nonce: bigint; amountPerPeriod: bigint; periodSecs: bigint; startTs: bigint; expiryTs: bigint; initId: bigint; payer?: PublicKey }) {
  const sa = subscriptionAuthorityPda(p.owner, p.mint);
  const keys = [meta(p.owner, true, true), meta(sa), meta(delegationPda(sa, p.owner, p.delegatee, p.nonce), true), meta(p.delegatee), meta(SystemProgram.programId)];
  if (p.payer) keys.push(meta(p.payer, true, true));
  return ix(keys, concat(Uint8Array.of(2), u64le(p.nonce), u64le(p.amountPerPeriod), u64le(p.periodSecs), i64le(p.startTs), i64le(p.expiryTs), i64le(p.initId)));
}

/** ix 3. The owner closes the allowance. Works without Petty Cash: any client that can send this instruction can revoke.
 *  When someone else paid the account's rent, the program requires that payer as a writable `receiver`. */
export const ixRevokeDelegation = (owner: PublicKey, delegation: PublicKey, receiver?: PublicKey) =>
  ix([meta(owner, true, true), meta(delegation, true), ...(receiver && !receiver.equals(owner) ? [meta(receiver, true)] : [])], Uint8Array.of(3));

// ── Spender instructions (signed by the delegatee: the agent's key) ──────────
type TransferParams = { delegation: PublicKey; delegator: PublicKey; delegatee: PublicKey; mint: PublicKey; amount: bigint; destinationTokenAccount: PublicKey };
function transferIx(disc: 4 | 5, p: TransferParams) {
  return ix(
    [
      meta(p.delegation, true),
      meta(subscriptionAuthorityPda(p.delegator, p.mint)),
      meta(ata(p.delegator, p.mint), true),
      meta(p.destinationTokenAccount, true),
      meta(p.mint),
      meta(TOKEN_PROGRAM_ID),
      meta(p.delegatee, false, true),
      meta(eventAuthorityPda()),
      meta(ALLOWANCES_PROGRAM_ID),
    ],
    concat(Uint8Array.of(disc), u64le(p.amount), p.delegator.toBytes(), p.mint.toBytes()),
  );
}
/** ix 4. Pull `amount` under a fixed allowance. The program rejects anything above what is left (error 300). */
export const ixTransferFixed = (p: TransferParams) => transferIx(4, p);
/** ix 5. Pull `amount` under a recurring allowance. The program rejects anything above the period limit (error 400). */
export const ixTransferRecurring = (p: TransferParams) => transferIx(5, p);

// ── Readers ─────────────────────────────────────────────────────────────────
/** SubscriptionAuthority: disc u8 @0 | user @1 | mint @33 | payer @65 | bump u8 @97 | init_id i64 @98. */
export const readSaInitId = (data: Uint8Array): bigint => readI64(data, 98);

export type DelegationView =
  | { type: "fixed"; delegator: PublicKey; delegatee: PublicKey; payer: PublicKey; mint: PublicKey; remaining: bigint; expiryTs: bigint }
  | { type: "recurring"; delegator: PublicKey; delegatee: PublicKey; payer: PublicKey; mint: PublicKey; amountPerPeriod: bigint; pulledInPeriod: bigint; remainingInPeriod: bigint; currentPeriodStartTs: bigint; periodSecs: bigint; expiryTs: bigint };

/** Header (107 bytes): disc u8 | version u8 | bump u8 | delegator @3 | delegatee @35 | payer @67 | init_id @99.
 *  Fixed (187): … | subscription_authority @107 | mint @139 | amount u64 @171 | expiry_ts i64 @179.
 *  Recurring (211): … | mint @139 | current_period_start_ts @171 | period_length_s @179 | expiry_ts @187 | amount_per_period @195 | amount_pulled_in_period @203. */
export function readDelegation(data: Uint8Array): DelegationView | null {
  if (data.length < 187) return null;
  const disc = data[0];
  const delegator = new PublicKey(data.subarray(3, 35));
  const delegatee = new PublicKey(data.subarray(35, 67));
  const payer = new PublicKey(data.subarray(67, 99));
  const mint = new PublicKey(data.subarray(139, 171));
  if (disc === 3 && data.length >= 211) {
    const amountPerPeriod = readU64(data, 195);
    const pulledInPeriod = readU64(data, 203);
    return { type: "recurring", delegator, delegatee, payer, mint, currentPeriodStartTs: readI64(data, 171), periodSecs: readU64(data, 179), expiryTs: readI64(data, 187),
      amountPerPeriod, pulledInPeriod, remainingInPeriod: amountPerPeriod > pulledInPeriod ? amountPerPeriod - pulledInPeriod : 0n };
  }
  if (disc === 2) return { type: "fixed", delegator, delegatee, payer, mint, remaining: readU64(data, 171), expiryTs: readI64(data, 179) };
  return null;
}

/** Pulls the custom program error number out of a web3.js error or simulation log, if there is one. */
export function allowancesErrorCode(e: unknown): number | null {
  const s = typeof e === "string" ? e : e instanceof Error ? `${e.message} ${JSON.stringify((e as { logs?: unknown }).logs ?? "")}` : JSON.stringify(e);
  const m = /custom program error: 0x([0-9a-fA-F]+)/.exec(s) ?? /"Custom":\s*(\d+)/.exec(s);
  if (!m) return null;
  return m[0].includes("0x") ? parseInt(m[1], 16) : Number(m[1]);
}
