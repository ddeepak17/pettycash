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
export async function sendAndConfirm(
  instructions: TransactionInstruction[], feePayer: PublicKey, signers: Signer[],
  opts: { skipPreflight?: boolean; commitment?: Commitment; /** Called after signing and simulation, BEFORE the transaction is broadcast, so the caller can write the signature down first. */ onSigned?: (signature: string, lastValidBlockHeight: number) => Promise<void> } = {},
): Promise<{ signature: string; slot: number; ms: number }> {
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

  if (opts.onSigned) await opts.onSigned(signature, lastValidBlockHeight);
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

export type Outcome = "landed" | "failed" | "expired" | "unknown";

/** What became of a transaction we signed earlier. "expired" is only returned when it can never land any more. */
export async function signatureOutcome(signature: string, lastValidBlockHeight: number | null): Promise<Outcome> {
  try {
    const status = (await read((c) => c.getSignatureStatuses([signature], { searchTransactionHistory: true }))).value[0];
    if (status) {
      if (status.err) return "failed";
      return status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized" ? "landed" : "unknown";
    }
    if (lastValidBlockHeight === null) return "unknown";
    // Not found. It is only certain that it will never land once the chain has FINALIZED past its last valid height.
    const height = await read((c) => c.getBlockHeight("finalized"));
    if (height <= lastValidBlockHeight) return "unknown";
    // Look once more: it may have landed between the two reads.
    const again = (await read((c) => c.getSignatureStatuses([signature], { searchTransactionHistory: true }))).value[0];
    if (again) return again.err ? "failed" : "landed";
    return "expired";
  } catch {
    return "unknown";
  }
}

/** A blockhash is usable for 150 blocks after it was produced. A transaction built now therefore cannot land after
 *  this height, whatever blockhash it used (a blockhash cannot come from the future). The default doubles the 150
 *  blocks, so a seller-supplied blockhash from a node slightly ahead of ours is still covered. */
export const PAYMENT_VALID_BLOCKS = Number(process.env.PAYMENT_VALID_BLOCKS ?? 300);
export const currentBlockHeight = () => read((c) => c.getBlockHeight("confirmed"));

/** True only when a FINALIZED block is past the height. Asking "is this blockhash valid?" is not enough: a blockhash
 *  that is too new to be finalized gets the same answer as one that has expired. */
export async function finalizedPast(height: number): Promise<boolean | null> {
  try { return (await read((c) => c.getBlockHeight("finalized"))) > height; } catch { return null; }
}
