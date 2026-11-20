/** Turns wallet, RPC and network failures into one plain sentence. */
export function explainError(e: unknown): string {
  const err = e as { name?: string; message?: string; code?: number; error?: { message?: string } };
  const raw = `${err?.name ?? ""} ${err?.message ?? ""} ${err?.error?.message ?? ""}`;
  const m = raw.toLowerCase();
  if (err?.code === 4001 || /reject|declin|denied|cancel|user closed|closed the/.test(m)) return "The wallet request was closed without approving. Nothing was sent and nothing was spent. You can try again.";
  if (/wrong network|cluster|chain|genesis|devnet|mainnet/.test(m) && /mismatch|wrong|switch|unsupported|different/.test(m)) return "Your wallet looks like it is on a different Solana network. Switch it to the network shown at the top of this page and try again.";
  if (/timed out|timeout/.test(m)) return raw.includes("Timed out waiting") ? (err.message ?? "Timed out.") : "The request took too long. Check your connection and try again.";
  if (/blockhash/.test(m)) return "The network moved on before the wallet signed. Try again.";
  if (/insufficient|0x1\b|attempt to debit/.test(m)) return "The wallet does not have enough SOL or USDC for this. Add funds and try again.";
  if (/429|rate/.test(m)) return "The network is busy right now. Wait a few seconds and try again.";
  if (/failed to fetch|network request failed|could not reach/.test(m)) return "Could not reach the network. Check your connection and try again.";
  if (/not installed|not found in this browser/.test(m)) return err.message ?? "That wallet is not installed.";
  return err?.message && err.message.length < 200 ? err.message : "Something went wrong. Nothing was spent. Try again in a moment.";
}
