// Solana RPC access with failover. Reads try each endpoint in turn; a signed transaction is broadcast to all of
// them and confirmed by polling, so one slow or rate-limited endpoint cannot stall a purchase.
import { Connection, type Commitment, type Signer, Transaction, type TransactionInstruction, type PublicKey } from "@solana/web3.js";
import { rpcUrls } from "./config";

const conns = new Map<string, Connection>();
const conn = (url: string) => {
  let c = conns.get(url);
  if (!c) { c = new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true }); conns.set(url, c); }
  return c;
};
export const primaryRpcUrl = () => rpcUrls()[0];
export const primary = () => conn(primaryRpcUrl());

/** Runs a read against each endpoint until one answers. */
export async function read<T>(fn: (c: Connection) => Promise<T>): Promise<T> {
  let last: unknown;
  for (const url of rpcUrls()) {
    try { return await fn(conn(url)); } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error("All RPC endpoints failed");
}

export class TransactionFailed extends Error {
  constructor(public signature: string | null, public detail: unknown, public logs: string[] = []) {
    super(`Transaction failed: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
}
export class TransactionExpired extends Error {
  constructor(public signature: string) { super("Transaction was not confirmed before its blockhash expired"); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Signs, simulates, broadcasts and waits for `confirmed`. Throws TransactionFailed with program logs when the chain refuses. */
export async function sendAndConfirm(instructions: TransactionInstruction[], feePayer: PublicKey, signers: Signer[], opts: { skipPreflight?: boolean; commitment?: Commitment } = {}): Promise<{ signature: string; slot: number; ms: number }> {
  const started = Date.now();
  const { blockhash, lastValidBlockHeight } = await read((c) => c.getLatestBlockhash("confirmed"));
  const tx = new Transaction({ feePayer, blockhash, lastValidBlockHeight }).add(...instructions);
  tx.sign(...signers);
  const raw = tx.serialize();
  const signature = (await import("bs58")).default.encode(tx.signature!);

  if (!opts.skipPreflight) {
    const sim = await read((c) => c.simulateTransaction(tx));
    if (sim.value.err) throw new TransactionFailed(null, sim.value.err, sim.value.logs ?? []);
  }

  const broadcast = () => Promise.allSettled(rpcUrls().map((u) => conn(u).sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 })));
  await broadcast();
  let lastBroadcast = Date.now();
  for (;;) {
    const status = await read((c) => c.getSignatureStatuses([signature])).then((r) => r.value[0]).catch(() => null);
    if (status?.err) {
      const logs = await read((c) => c.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })).then((t) => t?.meta?.logMessages ?? []).catch(() => []);
      throw new TransactionFailed(signature, status.err, logs);
    }
    if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return { signature, slot: status.slot, ms: Date.now() - started };
    const height = await read((c) => c.getBlockHeight("confirmed")).catch(() => 0);
    if (height > lastValidBlockHeight) throw new TransactionExpired(signature);
    if (Date.now() - lastBroadcast > 1500) { void broadcast(); lastBroadcast = Date.now(); }
    await sleep(350);
  }
}

/** Simulation only: asks the chain what would happen, without sending anything or paying a fee. */
export async function simulate(instructions: TransactionInstruction[], feePayer: PublicKey, signers: Signer[]): Promise<{ err: unknown; logs: string[] }> {
  const { blockhash, lastValidBlockHeight } = await read((c) => c.getLatestBlockhash("confirmed"));
  const tx = new Transaction({ feePayer, blockhash, lastValidBlockHeight }).add(...instructions);
  tx.sign(...signers);
  const sim = await read((c) => c.simulateTransaction(tx));
  return { err: sim.value.err, logs: sim.value.logs ?? [] };
}
