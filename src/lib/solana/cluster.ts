// Cluster constants shared by the server and the browser. No secrets here.
import type { Cluster } from "../types";

export const CLUSTERS: Record<Cluster, { network: string; usdcMint: string; label: string; realMoney: boolean; explorerQuery: string }> = {
  "mainnet-beta": {
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    label: "Solana mainnet",
    realMoney: true,
    explorerQuery: "",
  },
  devnet: {
    network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    usdcMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    label: "Solana devnet (test money)",
    realMoney: false,
    explorerQuery: "?cluster=devnet",
  },
};

export const USDC_DECIMALS = 6;

export const explorerTx = (signature: string, cluster: Cluster) => `https://explorer.solana.com/tx/${signature}${CLUSTERS[cluster].explorerQuery}`;
export const explorerAddress = (address: string, cluster: Cluster) => `https://explorer.solana.com/address/${address}${CLUSTERS[cluster].explorerQuery}`;

/** "1000" -> "$0.001", "1250000" -> "$1.25". Shows up to 4 decimals and never rounds a non-zero amount to $0.00. */
export function formatUsd(base: string | bigint): string {
  const n = typeof base === "bigint" ? base : BigInt(base);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0");
  let decimals = frac.slice(0, 2);
  const rest = frac.slice(2).replace(/0+$/, "");
  if (rest) decimals = frac.slice(0, Math.min(6, 2 + rest.length));
  return `${neg ? "-" : ""}$${whole.toLocaleString("en-US")}.${decimals}`;
}

/** "1.25" -> 1250000n. Rejects anything that is not a plain non-negative decimal with at most 6 places. */
export function parseUsd(input: string): bigint | null {
  const m = /^\s*\$?\s*(\d{1,9})(?:\.(\d{1,6}))?\s*$/.exec(input);
  if (!m) return null;
  return BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0") || "0");
}

export const shortAddress = (a: string, n = 4) => (a.length <= n * 2 + 1 ? a : `${a.slice(0, n)}…${a.slice(-n)}`);
