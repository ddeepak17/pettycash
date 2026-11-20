// The pre-send check: a signed payment may leave the process only if it is exactly the quoted transfer.
import { describe, expect, it } from "vitest";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createApproveInstruction, createTransferCheckedInstruction, createTransferInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { assertPaymentIsExactlyTheQuote } from "../../src/lib/x402/client";

const agent = Keypair.generate().publicKey, facilitator = Keypair.generate().publicKey, seller = Keypair.generate().publicKey, thief = Keypair.generate().publicKey;
const mint = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const src = getAssociatedTokenAddressSync(mint, agent), dst = getAssociatedTokenAddressSync(mint, seller);
const expected = { agent, payTo: seller, mint, amount: 1000n };
const budget = [ComputeBudgetProgram.setComputeUnitLimit({ units: 20_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 })];
const memo = new TransactionInstruction({ programId: MEMO, keys: [], data: Buffer.from("abc123") });
const transfer = (amount = 1000n, to = dst, from = src, authority = agent, m = mint) => createTransferCheckedInstruction(from, m, to, authority, amount, 6);
const b64 = (ixs: TransactionInstruction[], payer = facilitator) =>
  Buffer.from(new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: "11111111111111111111111111111111", instructions: ixs }).compileToV0Message()).serialize()).toString("base64");

describe("pre-send payment check", () => {
  it("accepts exactly the quoted transfer and returns the memo", () => {
    expect(assertPaymentIsExactlyTheQuote(b64([...budget, transfer(), memo]), expected)).toEqual({ memo: "abc123" });
  });
  it("accepts a payment without a memo", () => expect(assertPaymentIsExactlyTheQuote(b64([...budget, transfer()]), expected).memo).toBeNull());
  it("refuses a different amount", () => expect(() => assertPaymentIsExactlyTheQuote(b64([...budget, transfer(1001n)]), expected)).toThrow(/amount/));
  it("refuses a different recipient", () => expect(() => assertPaymentIsExactlyTheQuote(b64([...budget, transfer(1000n, getAssociatedTokenAddressSync(mint, thief))]), expected)).toThrow(/recipient/));
  it("refuses a different token", () => {
    const other = Keypair.generate().publicKey;
    expect(() => assertPaymentIsExactlyTheQuote(b64([...budget, transfer(1000n, dst, src, agent, other)]), expected)).toThrow(/token/);
  });
  it("refuses a transfer out of someone else's account", () => expect(() => assertPaymentIsExactlyTheQuote(b64([...budget, transfer(1000n, dst, getAssociatedTokenAddressSync(mint, thief))]), expected)).toThrow(/own token account/));
  it("refuses a second transfer in the same transaction", () => expect(() => assertPaymentIsExactlyTheQuote(b64([...budget, transfer(), transfer()]), expected)).toThrow(/exactly one/));
  it("refuses an added token approval (the way a wallet gets drained later)", () => {
    expect(() => assertPaymentIsExactlyTheQuote(b64([...budget, transfer(), createApproveInstruction(src, thief, agent, 10n ** 12n)]), expected)).toThrow(/not TransferChecked/);
  });
  it("refuses a plain Transfer instead of TransferChecked", () => expect(() => assertPaymentIsExactlyTheQuote(b64([...budget, createTransferInstruction(src, dst, agent, 1000n)]), expected)).toThrow(/not TransferChecked/));
  it("refuses an instruction for any other program", () => {
    expect(() => assertPaymentIsExactlyTheQuote(b64([...budget, transfer(), SystemProgram.transfer({ fromPubkey: agent, toPubkey: thief, lamports: 1 })]), expected)).toThrow(/unexpected program/);
  });
  it("refuses a transaction with no transfer at all", () => expect(() => assertPaymentIsExactlyTheQuote(b64([...budget, memo]), expected)).toThrow(/exactly one/));
  it("refuses when the agent would pay the network fee", () => expect(() => assertPaymentIsExactlyTheQuote(b64([...budget, transfer()], agent), expected)).toThrow(/network fee/));
  it("refuses garbage", () => expect(() => assertPaymentIsExactlyTheQuote("not-a-transaction", expected)).toThrow());
});
