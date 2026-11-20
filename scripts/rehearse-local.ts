// Full rehearsal of the purchase engine on a local validator running the MAINNET build of the Allowances program,
// against a local x402 seller that really settles transfers on that local chain. No real funds, no real sellers.
//
//   solana-test-validator --reset --clone-upgradeable-program De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44 \
//     --url https://api.mainnet-beta.solana.com
//   pnpm tsx scripts/rehearse-local.ts
import { existsSync } from "node:fs";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createMint, getAccount, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { ata, delegationPda, ixCreateFixedDelegation, ixInitSubscriptionAuthority, ixRevokeDelegation, readSaInitId, subscriptionAuthorityPda } from "../src/lib/solana/allowances";
import { CLUSTERS } from "../src/lib/solana/cluster";
import type { RunEvent } from "../src/lib/types";
import { startLocalSeller } from "../tests/local/seller";

const RPC = process.env.LOCAL_RPC ?? "http://127.0.0.1:8899";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const results: { check: string; pass: boolean; detail: string }[] = [];
const record = (check: string, pass: boolean, detail = "") => { results.push({ check, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"}  ${check}${detail ? `  ${detail}` : ""}`); };

async function main() {
  const c = new Connection(RPC, "confirmed");
  const owner = Keypair.generate(), agent = Keypair.generate(), sellerWallet = Keypair.generate(), feePayer = Keypair.generate(), impostor = Keypair.generate();
  for (const k of [owner, agent, feePayer]) await c.confirmTransaction(await c.requestAirdrop(k.publicKey, 2 * LAMPORTS_PER_SOL), "confirmed");
  const mint = await createMint(c, owner, owner.publicKey, null, 6);
  for (const k of [owner, agent, sellerWallet]) await getOrCreateAssociatedTokenAccount(c, owner, mint, k.publicKey);
  await mintTo(c, owner, mint, ata(owner.publicKey, mint), owner, 10_000_000n);

  // Point the engine at the local chain. These must be set before the engine reads its configuration.
  Object.assign(process.env, {
    CLUSTER: "devnet", RPC_URLS: RPC, USDC_MINT_OVERRIDE: mint.toBase58(), AGENT_SECRET_KEY: JSON.stringify(Array.from(agent.secretKey)),
    UNRESOLVED_WINDOW_MS: "1500", PRIORITY_MICROLAMPORTS: "1",
  });
  const { purchase, settleUnresolved } = await import("../src/lib/agent/purchase");
  const { runAgent } = await import("../src/lib/agent/loop");
  const { proveOverspend, pull, readAllowance, ChainRefused, readAllowanceState } = await import("../src/lib/server/agentWallet");
  const { setApproval, sql, closeStore, getPurchase } = await import("../src/lib/server/store");

  const network = CLUSTERS.devnet.network;
  const seller = await startLocalSeller({ rpcUrl: RPC, network, mint, payTo: sellerWallet.publicKey, feePayer });
  const bal = async (k: PublicKey) => (await getAccount(c, ata(k, mint), "confirmed")).amount;
  const send = (ixs: Parameters<Transaction["add"]>, signers: Keypair[]) => sendAndConfirmTransaction(c, new Transaction().add(...ixs), signers, { commitment: "confirmed" });

  // The owner sets aside $0.05 for the agent, valid for an hour.
  await send([ixInitSubscriptionAuthority(owner.publicKey, mint)], [owner]);
  const sa = subscriptionAuthorityPda(owner.publicKey, mint);
  const initId = readSaInitId((await c.getAccountInfo(sa))!.data);
  const now = BigInt(Math.floor(Date.now() / 1000));
  await send([ixCreateFixedDelegation({ owner: owner.publicKey, mint, delegatee: agent.publicKey, nonce: 1n, amount: 50_000n, expiryTs: now + 3600n, initId })], [owner]);
  const allowance = delegationPda(sa, owner.publicKey, agent.publicKey, 1n);

  const state = await readAllowanceState(owner.publicKey);
  record("wallet state is read from the chain", state.authorityInitialized && state.allowances.length === 1 && state.allowances[0].remainingBase === "50000" && state.usdcBalanceBase === "10000000", JSON.stringify(state.allowances[0]));

  const limits = { perPurchaseMax: 50_000n, approvalThreshold: 10_000n, runBudget: 40_000n, approvalWaitMs: 8_000, maxSteps: 6 };
  const events: RunEvent[] = [];
  const emit = (e: RunEvent) => { events.push(e); };
  const ctx = (canAsk = false, spentInRun = 0n) => ({ runId: null, owner: owner.publicKey, allowance, step: 1, canAsk, limits, spentInRun, emit });
  const target = (path: string, payTo = sellerWallet.publicKey, maxPrice = 5_000n) => ({
    kind: "tool" as const, toolId: `local${path.replace(/\W/g, "_")}`, seller: { name: "Local seller", host: "127.0.0.1", payTo: payTo.toBase58(), maxPrice },
    request: { method: "GET" as const, url: `${seller.url}${path}` }, timeoutMs: 20_000,
  });
  const types = (from: number) => events.slice(from).map((e) => e.type).join(" > ");

  // A. Happy path.
  let mark = events.length;
  const a = await purchase(ctx(), target("/search?query=tacos"));
  record("A. purchase delivers", a.ok && a.amount === 1000n && a.text.includes("Local result"), types(mark));
  record("A. money moved owner -> seller, agent holds nothing", (await bal(owner.publicKey)) === 9_999_000n && (await bal(sellerWallet.publicKey)) === 1000n && (await bal(agent.publicKey)) === 0n,
    `owner=${await bal(owner.publicKey)} seller=${await bal(sellerWallet.publicKey)} agent=${await bal(agent.publicKey)}`);
  const rowA = a.ok ? await getPurchase(a.purchaseId) : null;
  record("A. receipt recorded with both signatures", !!rowA?.pull_sig && !!rowA?.pay_sig && rowA.status === "delivered" && !!rowA.pay_memo && !!rowA.response_sha256, `status=${rowA?.status} memo=${rowA?.pay_memo ? "yes" : "no"}`);

  // B. Seller takes the money and fails: recorded as paid and not delivered. No silent refund claim.
  mark = events.length;
  const b = await purchase(ctx(), target("/broken"));
  record("B. seller failure after settlement is reported as paid, not delivered", !b.ok && b.stage === "delivery" && b.paid === 1000n && (await bal(sellerWallet.publicKey)) === 2000n && (await bal(agent.publicKey)) === 0n, types(mark));

  // C. Seller never settles: the outcome is unknown at first, then the money goes back to the owner.
  mark = events.length;
  const before = await bal(owner.publicKey);
  const cOut = await purchase(ctx(), target("/ghost"));
  const held = await bal(agent.publicKey);
  record("C. unsettled payment is held, not guessed", !cOut.ok && cOut.stage === "payment" && held === 1000n, `${types(mark)} agentHolds=${held}`);
  const early = await settleUnresolved(owner.publicKey.toBase58());
  await new Promise((r) => setTimeout(r, 2000));
  const late = await settleUnresolved(owner.publicKey.toBase58());
  record("C. money returns to the owner only after the payment can no longer land", early.refunded === 0 && late.refunded === 1 && (await bal(owner.publicKey)) === before && (await bal(agent.publicKey)) === 0n,
    `early=${JSON.stringify(early)} late=${JSON.stringify(late)} owner=${await bal(owner.publicKey)}`);

  // D. Above the per-purchase ceiling: stopped by the rule check; no money moves.
  mark = events.length;
  const ownerBefore = await bal(owner.publicKey);
  const d = await purchase(ctx(), target("/pricey", sellerWallet.publicKey, 1_000_000n));
  record("D. over-ceiling purchase is denied before any money moves", !d.ok && d.stage === "policy" && (await bal(owner.publicKey)) === ownerBefore && !events.slice(mark).some((e) => e.type === "pulled"), d.ok ? "" : d.error);

  // E. Above the ask-first line: denied when nobody can approve; goes through when a person approves.
  const e1 = await purchase(ctx(false), target("/ask", sellerWallet.publicKey, 30_000n));
  record("E. ask-first purchase is denied when nobody can approve", !e1.ok && e1.stage === "policy");
  mark = events.length;
  const approver = (async () => {
    for (let i = 0; i < 40; i++) {
      const need = events.slice(mark).find((x) => x.type === "approval_needed");
      if (need && need.type === "approval_needed") { await setApproval(need.purchaseId, "approved"); return; }
      await new Promise((r) => setTimeout(r, 200));
    }
  })();
  const e2 = await purchase(ctx(true), target("/ask", sellerWallet.publicKey, 30_000n));
  await approver;
  record("E. ask-first purchase goes through after approval", e2.ok && e2.amount === 20_000n, types(mark));

  // F. The seller asks to be paid at a different wallet than the pinned one.
  const f = await purchase(ctx(false), target("/search?query=x", impostor.publicKey));
  record("F. changed recipient is not paid without a person", !f.ok && f.stage === "policy", f.ok ? "" : f.error);

  // G. The chain itself refuses an oversized pull, independent of our rule check.
  const live = (await readAllowance(allowance))!;
  let refusedCode: number | null = -1;
  try { await pull(live, live.remaining + 1n); } catch (err) { refusedCode = err instanceof ChainRefused ? err.code : -2; }
  record("G. Allowances program refuses a pull above what is left", refusedCode === 300, `code=${refusedCode} remaining=${live.remaining}`);
  const sim = await proveOverspend(allowance, false);
  const sent = await proveOverspend(allowance, true);
  record("G. test-the-limit: simulated and onchain refusal", sim.refused && sim.code === 300 && sent.refused && sent.code === 300 && !!sent.signature, `sim=${sim.name} sent=${sent.name} sig=${sent.signature?.slice(0, 12)}…`);

  // H. The agent loop with a scripted stand-in for the model (a test double; the real model is only used on mainnet).
  const local = (id: string, path: string, max: string) => ({
    id, name: "Local seller", host: "127.0.0.1", kind: "search" as const, description: "local", params: [{ name: "query", description: "q", required: true, example: "x" }],
    payTo: sellerWallet.publicKey.toBase58(), lastPriceBase: "1000", maxPriceBase: max, timeoutMs: 20_000, build: (i: Record<string, string>) => ({ method: "GET" as const, url: `${seller.url}${path}?query=${encodeURIComponent(i.query)}` }),
  });
  const catalog = { sellers: [local("search", "/search", "5000"), local("pricey", "/pricey", "1000000")], reasoning: { name: "Local brain", host: "127.0.0.1", url: `${seller.url}/chat/completions`, payTo: sellerWallet.publicKey.toBase58(), maxPriceBase: "5000", timeoutMs: 20_000 } };
  seller.brainScript.push(
    { say: "I will search first.", action: "buy", tool: "search", input: { query: "tacos" } },
    { say: "Now I will buy the expensive thing ten times.", action: "buy", tool: "pricey", input: { query: "x" } },
    { say: "I will try a tool that does not exist.", action: "buy", tool: "drain_wallet", input: {} },
    "Here is my answer without JSON",
    { say: "Done.", action: "answer", answer: "Tacos are available. [source](https://example.com/a)" },
  );
  mark = events.length;
  const sellerBefore = await bal(sellerWallet.publicKey);
  const run = await runAgent({ runId: null, owner: owner.publicKey, allowance, task: "Find tacos", canAsk: false, limits, emit, catalog });
  const sellerGain = (await bal(sellerWallet.publicKey)) - sellerBefore;
  record("H. agent loop: buys, is refused the expensive tool and the unknown tool, recovers from bad output, answers",
    run.status === "done" && run.answer?.includes("Tacos") === true && run.spent === 6000n && run.purchases === 6 && sellerGain === 6000n && (await bal(agent.publicKey)) === 0n,
    `status=${run.status} spent=${run.spent} purchases=${run.purchases} sellerGain=${sellerGain}`);
  record("H. the model never saw a way around the rules", !events.slice(mark).some((e) => e.type === "pulled" && BigInt(e.amountBase) > 1000n));

  // I. Run budget: an errand cannot spend past its own budget even when the petty cash has more.
  const i1 = await purchase(ctx(false, 39_500n), target("/search?query=y"));
  record("I. errand budget stops a purchase the petty cash could afford", !i1.ok && i1.stage === "policy", i1.ok ? "" : i1.error);

  // J. Revoke: the owner closes the petty cash. The agent's next purchase is refused by the chain's own state.
  await send([ixRevokeDelegation(owner.publicKey, allowance)], [owner]);
  mark = events.length;
  const j = await purchase(ctx(), target("/search?query=after-revoke"));
  record("J. after revoke nothing can be bought", !j.ok && (await readAllowance(allowance)) === null, j.ok ? "" : `${j.stage}: ${j.error}`);
  const afterRevoke = await proveOverspend(allowance, false);
  record("J. test-the-limit after revoke reports the petty cash is gone", afterRevoke.refused && afterRevoke.name === "allowanceMissing");

  // K. Expiry: an expired petty cash is refused by the program (error 128) even if our rule check were skipped.
  const chainNow = BigInt((await c.getBlockTime(await c.getSlot("confirmed"))) ?? Number(now));
  await send([ixCreateFixedDelegation({ owner: owner.publicKey, mint, delegatee: agent.publicKey, nonce: 2n, amount: 50_000n, expiryTs: chainNow + 3n, initId })], [owner]);
  const shortLived = delegationPda(sa, owner.publicKey, agent.publicKey, 2n);
  const fresh = (await readAllowance(shortLived))!;
  await new Promise((r) => setTimeout(r, 6000));
  let expiredCode: number | null = -1;
  try { await pull(fresh, 1000n); } catch (err) { expiredCode = err instanceof ChainRefused ? err.code : -2; }
  record("K. expired petty cash is refused by the program", expiredCode === 128, `code=${expiredCode}`);

  // Clean up the rows this rehearsal wrote.
  await sql()`delete from pettycash.purchases where owner = ${owner.publicKey.toBase58()}`;
  await seller.close();
  await closeStore();
  const failed = results.filter((r) => !r.pass);
  console.log(JSON.stringify({ rpc: RPC, checks: results.length, failed: failed.length, settledOnLocalChain: seller.settled.length }));
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
