// Server configuration, read from the environment. Never import this file from browser code.
import { Keypair, PublicKey } from "@solana/web3.js";
import { CLUSTERS } from "../solana/cluster";
import type { Cluster } from "../types";

const env = (name: string) => {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
};
const need = (name: string) => {
  const v = env(name);
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
};
const big = (name: string, fallback: bigint) => {
  const v = env(name);
  return v && /^\d+$/.test(v) ? BigInt(v) : fallback;
};

export const cluster = (): Cluster => (env("CLUSTER") === "devnet" ? "devnet" : "mainnet-beta");
export const clusterInfo = () => CLUSTERS[cluster()];
export const usdcMint = () => new PublicKey(env("USDC_MINT_OVERRIDE") ?? clusterInfo().usdcMint);
export const network = () => env("X402_NETWORK_OVERRIDE") ?? clusterInfo().network;

/** RPC endpoints in order of preference. Reads fail over to the next one; sends go to all of them. */
export const rpcUrls = (): string[] => {
  const v = env("RPC_URLS");
  if (v) return v.split(",").map((s) => s.trim()).filter(Boolean);
  return cluster() === "devnet" ? ["https://api.devnet.solana.com"] : ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"];
};

let cachedAgent: Keypair | null = null;
/** The agent's key: the only key that can spend from a petty cash. It never owns a person's funds beyond one purchase. */
export function agentKeypair(): Keypair {
  if (cachedAgent) return cachedAgent;
  const raw = JSON.parse(need("AGENT_SECRET_KEY")) as number[];
  if (!Array.isArray(raw) || raw.length !== 64) throw new Error("AGENT_SECRET_KEY must be a 64-byte JSON array");
  cachedAgent = Keypair.fromSecretKey(Uint8Array.from(raw));
  return cachedAgent;
}
export const agentPublicKey = (): PublicKey => (env("AGENT_PUBLIC_KEY") ? new PublicKey(need("AGENT_PUBLIC_KEY")) : agentKeypair().publicKey);

export const limits = () => ({
  /** The server refuses any single purchase above this. Default $0.05. */
  perPurchaseMaxBase: big("PER_PURCHASE_MAX_BASE", 50_000n),
  /** Above this a person is asked first. Default $0.01. */
  approvalThresholdBase: big("APPROVAL_THRESHOLD_BASE", 10_000n),
  /** Most a single run may spend unless the person chooses less. Default $0.25. */
  runBudgetBase: big("RUN_BUDGET_BASE", 250_000n),
  /** Most a single run on the public demo petty cash may spend. Default $0.03. */
  houseRunBudgetBase: big("HOUSE_RUN_BUDGET_BASE", 30_000n),
  maxSteps: Number(env("MAX_STEPS") ?? 6),
  approvalWaitMs: Number(env("APPROVAL_WAIT_MS") ?? 60_000),
  houseRunsPerHourPerIp: Number(env("HOUSE_RUNS_PER_HOUR_PER_IP") ?? 4),
  houseRunsPerHour: Number(env("HOUSE_RUNS_PER_HOUR") ?? 40),
});

/** The public demo petty cash: an allowance from a wallet we funded, so anyone can try without a wallet. */
export const house = (): { owner: PublicKey; delegation: PublicKey } | null => {
  const owner = env("HOUSE_OWNER"), delegation = env("HOUSE_DELEGATION");
  return owner && delegation ? { owner: new PublicKey(owner), delegation: new PublicKey(delegation) } : null;
};

/** Which model the agent buys its reasoning from. Each step is a paid request, so the choice is also a price choice:
 *  on 2026-11-20 one step was quoted at about $0.004 to $0.007 for Claude Haiku 4.5 and $0.001 to $0.002 for GPT-5.6 Luna. */
export const reasoning = () => ({
  model: env("REASONING_MODEL") ?? "anthropic/claude-haiku-4.5",
  /** The public demo petty cash uses the cheapest model that follows the protocol reliably, so the demo budget lasts. */
  houseModel: env("HOUSE_REASONING_MODEL") ?? env("REASONING_MODEL") ?? "anthropic/claude-haiku-4.5",
  maxTokens: Number(env("REASONING_MAX_TOKENS") ?? 500),
});

export const sessionSecret = () => need("SESSION_SECRET");
export const databaseUrl = () => need("DATABASE_URL");
export const priorityMicroLamports = () => Number(env("PRIORITY_MICROLAMPORTS") ?? 20_000);
