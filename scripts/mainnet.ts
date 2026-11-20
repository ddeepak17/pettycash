// Operations on Solana MAINNET with REAL money. Every command prints what it did and the transaction signatures.
// The owner key (the funded demo wallet) is read from OWNER_KEYPAIR and is used only here, never by the app.
//
//   pnpm tsx scripts/mainnet.ts status
//   pnpm tsx scripts/mainnet.ts fund-agent 0.015          move SOL from the demo wallet to the agent for network fees
//   pnpm tsx scripts/mainnet.ts house 1.00 86400 4        recurring petty cash: $1.00 per 86400 s, for 4 days
//   pnpm tsx scripts/mainnet.ts fixed 0.25 24             fixed petty cash: $0.25 for 24 hours
//   pnpm tsx scripts/mainnet.ts buy <allowance> <toolId> '<json input>'
//   pnpm tsx scripts/mainnet.ts errand <allowance> "<task>" [model]
//   pnpm tsx scripts/mainnet.ts prove <allowance> [send]
//   pnpm tsx scripts/mainnet.ts revoke <allowance>
//   pnpm tsx scripts/mainnet.ts settle
//   pnpm tsx scripts/mainnet.ts sweep <destination>       return all USDC and SOL from the demo wallet
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { createTransferCheckedInstruction, createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
process.env.CLUSTER = "mainnet-beta";

const ownerPath = process.env.OWNER_KEYPAIR ?? join(homedir(), ".config/pettycash/mainnet/owner.json");
const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(ownerPath, "utf8"))));
const usd = (s: string) => { const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(s); if (!m) throw new Error(`bad amount ${s}`); return BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0") || "0"); };
const out = (o: unknown) => console.log(JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
const evidence = (name: string, data: unknown) => {
  mkdirSync("docs/evidence", { recursive: true });
  const file = `docs/evidence/${new Date().toISOString().replace(/[:.]/g, "-")}-${name}.json`;
  writeFileSync(file, JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  console.log(`evidence written: ${file}`);
};

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const { agentKeypair, usdcMint } = await import("../src/lib/server/config");
  const { read, sendAndConfirm } = await import("../src/lib/server/rpc");
  const { readAllowance, readAllowanceState, proveOverspend, agentTokenBalance } = await import("../src/lib/server/agentWallet");
  const A = await import("../src/lib/solana/allowances");
  const { explorerTx } = await import("../src/lib/solana/cluster");
  const store = await import("../src/lib/server/store");
  const agent = agentKeypair();
  const mint = usdcMint();
  const link = (s: string | null | undefined) => (s ? explorerTx(s, "mainnet-beta") : null);
  const limits = { perPurchaseMax: 50_000n, approvalThreshold: 10_000n, runBudget: 60_000n, approvalWaitMs: 1000, maxSteps: 6 };

  try {
    switch (cmd) {
      case "status": {
        const state = await readAllowanceState(owner.publicKey);
        out({
          owner: owner.publicKey.toBase58(), ownerSol: Number(state.solLamports) / LAMPORTS_PER_SOL, ownerUsdcBase: state.usdcBalanceBase,
          agent: agent.publicKey.toBase58(), agentSol: (await read((c) => c.getBalance(agent.publicKey))) / LAMPORTS_PER_SOL, agentUsdcBase: (await agentTokenBalance()).toString(),
          authorityInitialized: state.authorityInitialized, allowances: state.allowances,
        });
        break;
      }
      case "fund-agent": {
        const lamports = Math.round(Number(args[0] ?? "0.015") * LAMPORTS_PER_SOL);
        const r = await sendAndConfirm([SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: agent.publicKey, lamports })], owner.publicKey, [owner]);
        out({ movedSol: lamports / LAMPORTS_PER_SOL, to: agent.publicKey.toBase58(), signature: r.signature, explorer: link(r.signature) });
        break;
      }
      case "house":
      case "fixed": {
        let state = await readAllowanceState(owner.publicKey);
        const sigs: Record<string, string> = {};
        if (!state.authorityInitialized) {
          sigs.setup = (await sendAndConfirm([A.ixInitSubscriptionAuthority(owner.publicKey, mint)], owner.publicKey, [owner])).signature;
          for (let i = 0; i < 10 && !state.authorityInitId; i++) { await new Promise((r) => setTimeout(r, 1500)); state = await readAllowanceState(owner.publicKey); }
        }
        if (!state.authorityInitId) throw new Error("spending authority not visible yet; run again");
        const now = BigInt(Math.floor(Date.now() / 1000));
        const nonce = BigInt(Date.now());
        const sa = A.subscriptionAuthorityPda(owner.publicKey, mint);
        const address = A.delegationPda(sa, owner.publicKey, agent.publicKey, nonce);
        const initId = BigInt(state.authorityInitId);
        const ix = cmd === "house"
          ? A.ixCreateRecurringDelegation({ owner: owner.publicKey, mint, delegatee: agent.publicKey, nonce, amountPerPeriod: usd(args[0] ?? "1.00"), periodSecs: BigInt(args[1] ?? "86400"), startTs: now + 20n, expiryTs: now + BigInt(Math.round(Number(args[2] ?? "4") * 86400)), initId })
          : A.ixCreateFixedDelegation({ owner: owner.publicKey, mint, delegatee: agent.publicKey, nonce, amount: usd(args[0] ?? "0.25"), expiryTs: now + BigInt(Math.round(Number(args[1] ?? "24") * 3600)), initId });
        sigs.create = (await sendAndConfirm([ix], owner.publicKey, [owner])).signature;
        const result = { kind: cmd, allowance: address.toBase58(), owner: owner.publicKey.toBase58(), agent: agent.publicKey.toBase58(), signatures: sigs, explorer: Object.fromEntries(Object.entries(sigs).map(([k, v]) => [k, link(v)])) };
        out(result);
        evidence(`${cmd}-allowance`, result);
        break;
      }
      case "buy": {
        const { purchase } = await import("../src/lib/agent/purchase");
        const { sellerById, cleanInput } = await import("../src/lib/agent/catalog");
        const allowance = new PublicKey(args[0]);
        const seller = sellerById(args[1]);
        if (!seller) throw new Error(`unknown tool ${args[1]}`);
        const input = cleanInput(seller, JSON.parse(args[2] ?? "{}"));
        if (!input.ok) throw new Error(input.error);
        const live = await readAllowance(allowance);
        if (!live) throw new Error("allowance not found");
        const events: unknown[] = [];
        const before = { ownerUsdc: (await readAllowanceState(live.view.delegator)).usdcBalanceBase, agentUsdc: (await agentTokenBalance()).toString(), remaining: live.remaining.toString() };
        const result = await purchase(
          { runId: null, owner: live.view.delegator, allowance, step: 1, canAsk: false, limits, spentInRun: 0n, emit: (e) => { events.push(e); console.log(`  ${e.type}`); } },
          { kind: "tool", toolId: seller.id, seller: { name: seller.name, host: seller.host, payTo: seller.payTo, maxPrice: BigInt(seller.maxPriceBase) }, request: seller.build(input.input), timeoutMs: seller.timeoutMs },
        );
        const row = result.purchaseId ? await store.getPurchase(result.purchaseId) : null;
        const after = { ownerUsdc: (await readAllowanceState(live.view.delegator)).usdcBalanceBase, agentUsdc: (await agentTokenBalance()).toString(), remaining: (await readAllowance(allowance))?.remaining.toString() };
        const summary = {
          tool: seller.id, seller: seller.name, url: seller.build(input.input).url, ok: result.ok, amountBase: result.ok ? result.amount : null, error: result.ok ? null : result.error,
          pullSignature: row?.pull_sig ?? null, paySignature: row?.pay_sig ?? null, pullExplorer: link(row?.pull_sig), payExplorer: link(row?.pay_sig), payTo: row?.pay_to, memo: row?.pay_memo,
          httpStatus: row?.http_status, responseSha256: row?.response_sha256, responseBytes: row?.response_bytes, responsePreview: result.ok ? result.text.slice(0, 600) : null, before, after, events,
        };
        out({ ...summary, events: undefined });
        evidence(`buy-${seller.id}`, summary);
        break;
      }
      case "errand": {
        const { runAgent } = await import("../src/lib/agent/loop");
        const allowance = new PublicKey(args[0]);
        const live = await readAllowance(allowance);
        if (!live) throw new Error("allowance not found");
        const events: unknown[] = [];
        const started = Date.now();
        const runId = await store.createRun({ owner: live.view.delegator.toBase58(), delegation: allowance.toBase58(), cluster: "mainnet-beta", task: args[1], model: args[2] ?? "default", isHouse: false });
        let seq = 0;
        const result = await runAgent({
          runId, owner: live.view.delegator, allowance, task: args[1], model: args[2], canAsk: false, limits,
          emit: async (e) => { events.push(e); await store.addEvent(runId, seq++, e); console.log(`  ${e.type}${e.type === "thinking" ? `: ${e.text}` : e.type === "quote" ? `: ${e.seller.name} ${e.amountBase}` : e.type === "purchase_failed" ? `: ${e.error}` : ""}`); },
        });
        await store.finishRun(runId, { status: result.status, answer: result.answer, spentBase: result.spent });
        const rows = await store.purchasesForRun(runId);
        const summary = {
          runId, task: args[1], model: args[2] ?? "default", status: result.status, spentBase: result.spent, purchases: result.purchases, seconds: (Date.now() - started) / 1000, answer: result.answer,
          receipts: rows.map((r) => ({ kind: r.kind, tool: r.tool_id, seller: r.seller_name, amountBase: r.amount_base, status: r.status, pull: r.pull_sig, pay: r.pay_sig, pullExplorer: link(r.pull_sig), payExplorer: link(r.pay_sig) })),
          events,
        };
        out({ ...summary, events: undefined });
        evidence("errand", summary);
        break;
      }
      case "prove": {
        const result = await proveOverspend(new PublicKey(args[0]), args[1] === "send");
        out({ ...result, explorer: link(result.signature) });
        evidence(`overlimit-${args[1] === "send" ? "onchain" : "simulated"}`, { allowance: args[0], ...result, explorer: link(result.signature) });
        break;
      }
      case "revoke": {
        const address = new PublicKey(args[0]);
        const live = await readAllowance(address);
        if (!live) throw new Error("allowance not found (already revoked?)");
        const r = await sendAndConfirm([A.ixRevokeDelegation(owner.publicKey, address, live.view.payer)], owner.publicKey, [owner]);
        const gone = (await readAllowance(address)) === null;
        const result = { revoked: address.toBase58(), signature: r.signature, explorer: link(r.signature), accountClosed: gone };
        out(result);
        evidence("revoke", result);
        break;
      }
      case "settle": {
        const { settleUnresolved } = await import("../src/lib/agent/purchase");
        out(await settleUnresolved());
        break;
      }
      case "sweep": {
        const dest = new PublicKey(args[0]);
        const state = await readAllowanceState(owner.publicKey);
        const sigs: string[] = [];
        if (BigInt(state.usdcBalanceBase) > 0n) {
          sigs.push((await sendAndConfirm([
            createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, A.ata(dest, mint), dest, mint),
            createTransferCheckedInstruction(A.ata(owner.publicKey, mint), mint, A.ata(dest, mint), owner.publicKey, BigInt(state.usdcBalanceBase), 6),
          ], owner.publicKey, [owner])).signature);
        }
        const lamports = (await read((c) => c.getBalance(owner.publicKey))) - 10_000;
        if (lamports > 0) sigs.push((await sendAndConfirm([SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: dest, lamports })], owner.publicKey, [owner])).signature);
        out({ sweptTo: dest.toBase58(), usdcBase: state.usdcBalanceBase, signatures: sigs });
        break;
      }
      default:
        console.error("commands: status | fund-agent [sol] | house [usd] [periodSecs] [days] | fixed [usd] [hours] | buy <allowance> <tool> '<json>' | errand <allowance> \"task\" [model] | prove <allowance> [send] | revoke <allowance> | settle | sweep <destination>");
        process.exitCode = 2;
    }
  } finally {
    await store.closeStore();
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
