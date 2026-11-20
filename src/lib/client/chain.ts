// Wallet actions: sign in, create a petty cash, revoke. Each one is a thin script over the instruction builders.
import { PublicKey, Transaction } from "@solana/web3.js";
import { ixCreateFixedDelegation, ixInitSubscriptionAuthority, ixRevokeDelegation } from "../solana/allowances";
import type { Allowance, AllowanceState, PublicConfig } from "../types";
import * as api from "./api";
import * as mock from "./mock";
import type { AppWallet } from "./wallet";

async function send(wallet: AppWallet, config: PublicConfig, build: (owner: PublicKey) => Transaction["instructions"][number][]): Promise<string> {
  const owner = new PublicKey(wallet.address!);
  const connection = api.getConnection(config);
  const tx = new Transaction().add(...build(owner));
  tx.feePayer = owner;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  const signature = await wallet.sendTransaction(tx, connection);
  if (!api.MOCK) await api.waitForSignature(connection, signature);
  return signature;
}

export async function signIn(wallet: AppWallet): Promise<void> {
  const owner = wallet.address!;
  const me = await api.authMe().catch(() => ({ owner: null }));
  if (me.owner === owner) return;
  const { message } = await api.authChallenge(owner);
  const sig = await wallet.signMessage(new TextEncoder().encode(message));
  let bin = ""; sig.forEach((b) => (bin += String.fromCharCode(b)));
  await api.authVerify(owner, message, btoa(bin));
}

export type CreateStep = "setup" | "create" | "done";

export async function createPettyCash(p: {
  wallet: AppWallet; config: PublicConfig; state: AllowanceState; amount: bigint; expiryTs: number; onStep: (s: CreateStep) => void;
}): Promise<void> {
  const { wallet, config, amount, expiryTs } = p;
  let state = p.state;
  const mint = new PublicKey(config.usdcMint);
  if (!state.authorityInitialized) {
    p.onStep("setup");
    if (api.MOCK) { await mock.mockSleep(900); mock.mockInitAuthority(); }
    else await send(wallet, config, (owner) => [ixInitSubscriptionAuthority(owner, mint)]);
    // The server may need a moment to see the new account.
    for (let i = 0; i < 8; i++) {
      state = await api.getAllowance(wallet.address!);
      if (state.authorityInitialized && state.authorityInitId) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (!state.authorityInitId) throw new Error("The one-time setup went through but the server has not seen it yet. Wait a few seconds and try again.");
  }
  p.onStep("create");
  if (api.MOCK) { await mock.mockSleep(900); mock.mockCreateAllowance(amount, expiryTs); }
  else {
    await send(wallet, config, (owner) => [ixCreateFixedDelegation({
      owner, mint, delegatee: new PublicKey(config.agent), nonce: BigInt(Date.now()), amount, expiryTs: BigInt(expiryTs), initId: BigInt(state.authorityInitId!),
    })]);
  }
  p.onStep("done");
}

export async function revokePettyCash(wallet: AppWallet, config: PublicConfig, a: Allowance): Promise<void> {
  if (api.MOCK) { await mock.mockSleep(900); mock.mockRevoke(a.address); return; }
  await send(wallet, config, (owner) => [ixRevokeDelegation(owner, new PublicKey(a.address), new PublicKey(a.rentPayer))]);
}
