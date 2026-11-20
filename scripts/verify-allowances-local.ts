// Verifies our instruction builders against the MAINNET build of Solana's Subscriptions & Allowances program,
// cloned into a local validator. No real funds: the token is a disposable local mint.
//
//   solana-test-validator --reset --limit-ledger-size 50000000 \
//     --clone-upgradeable-program De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44 --url https://api.mainnet-beta.solana.com
//   pnpm tsx scripts/verify-allowances-local.ts
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction, type Signer, type TransactionInstruction } from "@solana/web3.js";
import { createMint, getAccount, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import {
  ALLOWANCES_PROGRAM_ID, allowancesErrorCode, ata, delegationPda, ixCreateFixedDelegation, ixCreateRecurringDelegation, ixInitSubscriptionAuthority,
  ixRevokeDelegation, ixTransferFixed, ixTransferRecurring, readDelegation, readSaInitId, subscriptionAuthorityPda,
} from "../src/lib/solana/allowances";

const RPC = process.env.LOCAL_RPC ?? "http://127.0.0.1:8899";
const c = new Connection(RPC, "confirmed");
const results: { check: string; pass: boolean; detail: string }[] = [];
const record = (check: string, pass: boolean, detail: string) => { results.push({ check, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"}  ${check}  ${detail}`); };

async function send(ixs: TransactionInstruction[], signers: Signer[]) {
  return sendAndConfirmTransaction(c, new Transaction().add(...ixs), signers, { commitment: "confirmed" });
}
async function expectError(name: string, code: number | null, ixs: TransactionInstruction[], signers: Signer[]) {
  try {
    const sig = await send(ixs, signers);
    record(name, false, `unexpectedly succeeded: ${sig}`);
  } catch (e) {
    const got = allowancesErrorCode(e);
    record(name, code === null ? true : got === code, `program error ${got ?? "(none parsed)"}${code === null ? "" : `, expected ${code}`}`);
  }
}
const bal = async (owner: PublicKey, mint: PublicKey) => (await getAccount(c, ata(owner, mint), "confirmed")).amount;

async function main() {
  const info = await c.getAccountInfo(ALLOWANCES_PROGRAM_ID);
  if (!info?.executable) throw new Error("Allowances program is not loaded in the local validator");
  const owner = Keypair.generate(), agent = Keypair.generate(), seller = Keypair.generate(), stranger = Keypair.generate();
  for (const k of [owner, agent, stranger]) await c.confirmTransaction(await c.requestAirdrop(k.publicKey, 2 * LAMPORTS_PER_SOL), "confirmed");

  const mint = await createMint(c, owner, owner.publicKey, null, 6);
  for (const k of [owner, agent, seller, stranger]) await getOrCreateAssociatedTokenAccount(c, owner, mint, k.publicKey);
  await mintTo(c, owner, mint, ata(owner.publicKey, mint), owner, 10_000_000n);

  // 1. Owner initialises the spending authority, then creates a fixed allowance of 1.00 for the agent.
  await send([ixInitSubscriptionAuthority(owner.publicKey, mint)], [owner]);
  const sa = subscriptionAuthorityPda(owner.publicKey, mint);
  const initId = readSaInitId((await c.getAccountInfo(sa))!.data);
  const tokenAcc = await getAccount(c, ata(owner.publicKey, mint));
  record("init: SA PDA is the token account's delegate", tokenAcc.delegate?.equals(sa) ?? false, `delegate=${tokenAcc.delegate?.toBase58()} initId=${initId}`);

  const now = BigInt(Math.floor(Date.now() / 1000));
  const nonce = 1n;
  await send([ixCreateFixedDelegation({ owner: owner.publicKey, mint, delegatee: agent.publicKey, nonce, amount: 1_000_000n, expiryTs: now + 3600n, initId })], [owner]);
  const dPda = delegationPda(sa, owner.publicKey, agent.publicKey, nonce);
  let d = readDelegation((await c.getAccountInfo(dPda))!.data);
  record("create fixed: account decodes", d?.type === "fixed" && d.remaining === 1_000_000n && d.delegatee.equals(agent.publicKey) && d.mint.equals(mint), JSON.stringify(d, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

  // 2. Agent pulls 0.25 into its own token account (the just-in-time pull).
  const base = { delegation: dPda, delegator: owner.publicKey, delegatee: agent.publicKey, mint };
  await send([ixTransferFixed({ ...base, amount: 250_000n, destinationTokenAccount: ata(agent.publicKey, mint) })], [agent]);
  d = readDelegation((await c.getAccountInfo(dPda))!.data);
  record("pull 0.25: balances and remaining", (await bal(owner.publicKey, mint)) === 9_750_000n && (await bal(agent.publicKey, mint)) === 250_000n && d?.type === "fixed" && d.remaining === 750_000n,
    `owner=${await bal(owner.publicKey, mint)} agent=${await bal(agent.publicKey, mint)} remaining=${d?.type === "fixed" ? d.remaining : "?"}`);

  // 3. Over the cap: the program itself refuses.
  await expectError("pull 0.80 with 0.75 left is rejected by the program", 300, [ixTransferFixed({ ...base, amount: 800_000n, destinationTokenAccount: ata(agent.publicKey, mint) })], [agent]);

  // 4. A different key cannot use the allowance.
  await expectError("stranger cannot pull", null, [ixTransferFixed({ ...base, delegatee: stranger.publicKey, amount: 10_000n, destinationTokenAccount: ata(stranger.publicKey, mint) })], [stranger]);

  // 5. The program places no restriction on the destination of a fixed allowance (documented limitation).
  await send([ixTransferFixed({ ...base, amount: 100_000n, destinationTokenAccount: ata(seller.publicKey, mint) })], [agent]);
  record("pull straight to a third party is allowed by the program", (await bal(seller.publicKey, mint)) === 100_000n, `seller=${await bal(seller.publicKey, mint)}`);

  // 6. Owner revokes; the next pull fails because the allowance account no longer exists.
  await send([ixRevokeDelegation(owner.publicKey, dPda)], [owner]);
  record("revoke closes the allowance account", (await c.getAccountInfo(dPda)) === null, "account closed");
  await expectError("pull after revoke is rejected", null, [ixTransferFixed({ ...base, amount: 10_000n, destinationTokenAccount: ata(agent.publicKey, mint) })], [agent]);

  // 7. Recurring allowance: 0.50 per 60 seconds.
  const rn = 2n;
  await send([ixCreateRecurringDelegation({ owner: owner.publicKey, mint, delegatee: agent.publicKey, nonce: rn, amountPerPeriod: 500_000n, periodSecs: 60n, startTs: now + 2n, expiryTs: now + 3600n, initId })], [owner]);
  await new Promise((r) => setTimeout(r, 4000));
  const rbase = { delegation: delegationPda(sa, owner.publicKey, agent.publicKey, rn), delegator: owner.publicKey, delegatee: agent.publicKey, mint, destinationTokenAccount: ata(agent.publicKey, mint) };
  await send([ixTransferRecurring({ ...rbase, amount: 300_000n })], [agent]);
  const rd = readDelegation((await c.getAccountInfo(delegationPda(sa, owner.publicKey, agent.publicKey, rn)))!.data);
  record("recurring: pull 0.30 of 0.50", rd?.type === "recurring" && rd.pulledInPeriod === 300_000n && rd.remainingInPeriod === 200_000n, JSON.stringify(rd, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  await expectError("recurring: second 0.30 in the same period is rejected", 400, [ixTransferRecurring({ ...rbase, amount: 300_000n })], [agent]);

  // 8. An expired fixed allowance cannot be used.
  const en = 3n;
  const chainNow = BigInt((await c.getBlockTime(await c.getSlot("confirmed"))) ?? Number(now));
  await send([ixCreateFixedDelegation({ owner: owner.publicKey, mint, delegatee: agent.publicKey, nonce: en, amount: 1_000_000n, expiryTs: chainNow + 3n, initId })], [owner]);
  await new Promise((r) => setTimeout(r, 6000));
  await expectError("expired allowance is rejected", 128, [ixTransferFixed({ ...base, delegation: delegationPda(sa, owner.publicKey, agent.publicKey, en), amount: 10_000n, destinationTokenAccount: ata(agent.publicKey, mint) })], [agent]);

  const failed = results.filter((r) => !r.pass);
  console.log(JSON.stringify({ rpc: RPC, program: ALLOWANCES_PROGRAM_ID.toBase58(), programDataLength: info.data.length, checks: results.length, failed: failed.length }));
  if (failed.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
