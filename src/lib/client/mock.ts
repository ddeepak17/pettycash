// Scripted preview data for development. Only used when NEXT_PUBLIC_MOCK=1. Nothing here is real.
import type { Allowance, AllowanceState, PublicConfig, ProofResult, Receipt, RunDetail, RunEvent, RunRequest, SellerRef } from "../types";

const OWNER = "7vQeMockOwner1111111111111111111111111111Xk2P";
const AGENT = "AgNtMockAgent11111111111111111111111111111b9Rw";
const HOUSE_OWNER = "HoUsEMockOwner111111111111111111111111111mQ4d";
export const MOCK_OWNER = OWNER;

const sig = (n: number) => `MockSig${n}`.padEnd(88, "x");
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });

export const mockConfig = (): PublicConfig => ({
  cluster: "mainnet-beta",
  network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  rpcUrl: "/api/rpc",
  usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  agent: AGENT,
  allowancesProgram: "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44",
  limits: { perPurchaseMaxBase: "250000", approvalThresholdBase: "10000", maxSteps: 8 },
  house: { owner: HOUSE_OWNER, delegation: "HouseMockAllowance1111111111111111111111111aaaa", remainingBase: "2350000", perRunBudgetBase: "100000", expiryTs: Math.floor(Date.now() / 1000) + 86400 * 2 },
  streamActive: true,
  catalog: [
    { id: "search", name: "Northwind Search", host: "search.northwind.example", kind: "search", description: "Web search results", lastPriceBase: "5000", record: { purchases: 42, delivered: 42 } },
    { id: "read", name: "Lakeshore Reader", host: "read.lakeshore.example", kind: "read", description: "Reads a page and returns clean text", lastPriceBase: "20000", record: { purchases: 17, delivered: 16 } },
    { id: "data", name: "Meridian Market Data", host: "data.meridian.example", kind: "data", description: "Prices and market data", lastPriceBase: "40000", record: { purchases: 9, delivered: 9 } },
  ],
});

// Mutable in-memory world so wallet actions feel real in preview.
const world = {
  authority: false,
  allowances: [] as Allowance[],
  usd: "12500000",
  sol: "21000000",
  signedIn: false,
  receipts: [] as (Receipt & { verifyAt: number })[],
  runs: new Map<string, RunDetail>(),
};

export const mockAllowance = (owner: string): AllowanceState => ({
  owner,
  usdcBalanceBase: world.usd,
  solLamports: world.sol,
  authorityInitialized: world.authority,
  authorityInitId: world.authority ? "1732000000" : null,
  allowances: world.allowances.map((a) => ({ ...a, expired: a.expiryTs !== 0 && a.expiryTs * 1000 < Date.now() })),
});
export const mockInitAuthority = () => { world.authority = true; };
export const mockCreateAllowance = (amount: bigint, expiryTs: number) => {
  world.allowances.push({ address: "MockAllowance" + (world.allowances.length + 1).toString().padEnd(31, "q"), nonce: String(Date.now()), type: "fixed", remainingBase: amount.toString(), expiryTs, expired: false, rentPayer: OWNER });
};
export const mockRevoke = (address: string) => { world.allowances = world.allowances.filter((a) => a.address !== address); };
export const mockSession = () => ({ owner: world.signedIn ? OWNER : null });
export const mockSignIn = () => { world.signedIn = true; };
export const mockSignOut = () => { world.signedIn = false; };

const seller = (name: string, host: string, path: string): SellerRef => ({ id: host.split(".")[0], name, host, url: `https://${host}${path}` });

type Gate = { resolve: (d: "approved" | "denied") => void };
const gates = new Map<string, Gate>();
export const mockApprove = (purchaseId: string, decision: "approved" | "denied") => { gates.get(purchaseId)?.resolve(decision); gates.delete(purchaseId); };

const mkReceipt = (runId: string, owner: string, id: string, s: SellerRef, amount: string, n: number, kind: "tool" | "reasoning" = "tool"): Receipt & { verifyAt: number } => ({
  id, runId, owner, kind, seller: s, payTo: "Pay" + s.id + "To".padEnd(38, "z"), amountBase: amount, status: "delivered",
  pullSignature: sig(n), paySignature: sig(n + 1), refundSignature: null, httpStatus: 200, responseSha256: "ab".repeat(32), responseBytes: 4210, createdAt: Date.now(),
  pullProof: null, payProof: null, verified: false, mismatch: null, verifyAt: Date.now() + 6000 + n * 1500,
});

const PREVIEW = "Austin forecast: Saturday high 71F, low 52F, partly cloudy. Sunday high 66F with a 30% chance of light rain after 3 PM. Winds from the north at 10 to 15 mph on Saturday evening...";
const ANSWER = "**Short answer: bring a light jacket.**\n\n- Saturday is mild, 71F at the high and 52F overnight, so a jacket helps in the evening.\n- Sunday cools to 66F with a 30% chance of light rain after 3 PM.\n- Source: [Northwind forecast summary](https://search.northwind.example/austin-weekend)\n\nI spent two small purchases on this. A third, larger data purchase was refused by Solana because the limit was nearly used up.";

export function scriptEvents(task: string, owner: string, delegation: string): { ev: RunEvent; wait: number; gate?: string }[] {
  const s1 = seller("Northwind Search", "search.northwind.example", "/q?text=austin+weekend+weather");
  const s2 = seller("Lakeshore Reader", "read.lakeshore.example", "/read?u=weather.example/austin");
  const s3 = seller("Meridian Market Data", "data.meridian.example", "/series/hourly");
  const rid = "mockrun" + Date.now().toString(36);
  const chk = (extra?: boolean) => [
    { rule: "Approved seller", pass: true, detail: "The seller is on the approved list." },
    { rule: "Per-purchase ceiling", pass: true, detail: "Under the $0.25 ceiling." },
    { rule: "Run budget", pass: true, detail: "Within this run's $0.10 budget." },
    { rule: "Asks you first above $0.01", pass: !extra, detail: extra ? "This price is above $0.01, so you decide." : "Below the approval line." },
  ];
  return [
    { wait: 300, ev: { type: "run_started", runId: rid, owner, delegation, task, runBudgetBase: "100000", remainingBase: "1000000", at: Date.now() } },
    { wait: 1200, ev: { type: "thinking", step: 1, text: "Search for the weekend forecast first, it is the cheapest way to start." } },
    { wait: 900, ev: { type: "quote", purchaseId: "p1", step: 1, kind: "tool", seller: s1, amountBase: "5000", payTo: "PayNorthwind", description: "Web search: Austin weather this weekend" } },
    { wait: 500, ev: { type: "policy", purchaseId: "p1", decision: "allow", checks: chk() } },
    { wait: 900, ev: { type: "pulled", purchaseId: "p1", signature: sig(1), amountBase: "5000", remainingBase: "995000", ms: 820 } },
    { wait: 1100, ev: { type: "paid", purchaseId: "p1", signature: sig(2), httpStatus: 200, ms: 1100 } },
    { wait: 600, ev: { type: "delivered", purchaseId: "p1", bytes: 4210, sha256: "ab".repeat(32), preview: PREVIEW } },
    { wait: 1200, ev: { type: "thinking", step: 2, text: "One result has hourly detail. I want to read that page in full." } },
    { wait: 800, ev: { type: "quote", purchaseId: "p2", step: 2, kind: "tool", seller: s2, amountBase: "20000", payTo: "PayLakeshore", description: "Read page: weather.example/austin" } },
    { wait: 500, ev: { type: "policy", purchaseId: "p2", decision: "ask", checks: chk(true) } },
    { wait: 300, gate: "p2", ev: { type: "approval_needed", purchaseId: "p2", amountBase: "20000", seller: s2, reason: "This is more than $0.01, so the agent needs your yes.", expiresAt: Date.now() + 60000 } },
    { wait: 700, ev: { type: "approval_result", purchaseId: "p2", decision: "approved" } },
    { wait: 800, ev: { type: "pulled", purchaseId: "p2", signature: sig(3), amountBase: "20000", remainingBase: "975000", ms: 910 } },
    { wait: 1000, ev: { type: "paid", purchaseId: "p2", signature: sig(4), httpStatus: 200, ms: 1300 } },
    { wait: 600, ev: { type: "delivered", purchaseId: "p2", bytes: 18930, sha256: "cd".repeat(32), preview: "Hourly outlook for Austin, TX. Saturday 6 PM: 68F clear. Saturday 9 PM: 61F clear. Sunday 3 PM: 66F light rain possible..." } },
    { wait: 1200, ev: { type: "thinking", step: 3, text: "Check hourly market-style data for rain probability from a second source." } },
    { wait: 800, ev: { type: "quote", purchaseId: "p3", step: 3, kind: "tool", seller: s3, amountBase: "40000", payTo: "PayMeridian", description: "Hourly series: precipitation probability" } },
    { wait: 500, ev: { type: "policy", purchaseId: "p3", decision: "allow", checks: chk() } },
    { wait: 900, ev: { type: "chain_refused", purchaseId: "p3", code: 300, name: "amountExceedsLimit", plain: "The amount is more than what is left in this petty cash." } },
    { wait: 1000, ev: { type: "thinking", step: 4, text: "That purchase was refused. I have enough to answer without it." } },
    { wait: 1400, ev: { type: "answer", text: ANSWER } },
    { wait: 400, ev: { type: "run_finished", runId: rid, status: "done", spentBase: "25000", purchases: 2, ms: 14800 } },
  ];
}

export async function mockRun(req: RunRequest, house: boolean, onEvent: (e: RunEvent) => void, signal: AbortSignal) {
  const owner = house ? HOUSE_OWNER : OWNER;
  const delegation = house ? mockConfig().house!.delegation : req.delegation ?? "MockAllowance1";
  const script = scriptEvents(req.task, owner, delegation);
  const events: RunEvent[] = [];
  const runId = (script[0].ev as Extract<RunEvent, { type: "run_started" }>).runId;
  for (const { ev: ev0, wait, gate } of script) {
    let ev = ev0;
    await sleep(wait, signal);
    if (gate) {
      onEvent(ev); events.push(ev);
      const decision = await new Promise<"approved" | "denied">((resolve, reject) => {
        gates.set(gate, { resolve });
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        setTimeout(() => resolve("denied"), 60000);
      });
      await sleep(400, signal);
      if (decision === "denied") {
        const r: RunEvent = { type: "approval_result", purchaseId: gate, decision: "denied" };
        const f: RunEvent = { type: "purchase_failed", purchaseId: gate, stage: "policy", error: "You said no, so nothing was bought.", refund: null };
        onEvent(r); onEvent(f); events.push(r, f);
        // skip the rest of this purchase
        const rest = script.slice(script.findIndex((x) => x.ev === ev) + 1).filter((x) => !("purchaseId" in x.ev && x.ev.purchaseId === gate));
        for (const x of rest) { await sleep(x.wait, signal); onEvent(x.ev); events.push(x.ev); }
        finish(runId, owner, req.task, events, house);
        return;
      }
      continue;
    }
    if (ev.type === "pulled" && !house && world.allowances[0]) {
      const a = world.allowances[0];
      a.remainingBase = (BigInt(a.remainingBase) - BigInt(ev.amountBase)).toString();
      ev = { ...ev, remainingBase: a.remainingBase };
    }
    onEvent(ev); events.push(ev);
    if (ev.type === "delivered") {
      const q = events.find((e) => e.type === "quote" && e.purchaseId === ev.purchaseId) as Extract<RunEvent, { type: "quote" }>;
      world.receipts.unshift(mkReceipt(runId, owner, ev.purchaseId + runId, q.seller, q.amountBase, ev.purchaseId === "p1" ? 1 : 3));
    }
  }
  finish(runId, owner, req.task, events, house);
}

function finish(runId: string, owner: string, task: string, events: RunEvent[], house: boolean) {
  const answer = (events.find((e) => e.type === "answer") as { text: string } | undefined)?.text ?? null;
  world.runs.set(runId, {
    run: { id: runId, owner, task, status: "done", answer, spentBase: "25000", isHouse: house, createdAt: Date.now() - 15000, finishedAt: Date.now() },
    events, receipts: world.receipts.filter((r) => r.runId === runId).map(stripVerify),
  });
}

const stripVerify = (r: Receipt & { verifyAt: number }): Receipt => {
  const { verifyAt, ...rest } = r;
  return { ...rest, verified: Date.now() > verifyAt, payProof: Date.now() > verifyAt ? { signature: r.paySignature ?? "", slot: 300000000, blockTime: Math.floor(Date.now() / 1000), ok: true, receivedAt: Date.now(), movements: [] } : null };
};

const seedFeed = (): Receipt[] => {
  const mk = (i: number, s: SellerRef, amt: string, ago: number): Receipt => ({ ...stripVerify({ ...mkReceipt("seed" + i, HOUSE_OWNER, "seed" + i, s, amt, 10 + i * 2), verifyAt: 0, createdAt: Date.now() - ago }) , verified: true });
  return [
    mk(1, seller("Northwind Search", "search.northwind.example", "/q"), "5000", 90_000),
    mk(2, seller("Lakeshore Reader", "read.lakeshore.example", "/read"), "20000", 200_000),
    mk(3, seller("Meridian Market Data", "data.meridian.example", "/series"), "40000", 700_000),
  ];
};
export const mockReceipts = (owner: string, house: boolean): Receipt[] => {
  const mine = world.receipts.filter((r) => (house ? r.owner === HOUSE_OWNER : r.owner === owner)).map(stripVerify);
  return house ? [...mine, ...seedFeed()] : mine;
};
export const mockRunDetail = (id: string): RunDetail => {
  const known = world.runs.get(id);
  if (known) return { ...known, receipts: world.receipts.filter((r) => r.runId === id).map(stripVerify) };
  const script = scriptEvents("What is the weather in Austin this weekend, and do I need a jacket?", HOUSE_OWNER, "HouseMock");
  const events = script.map((x) => x.ev);
  const receipts = [seedFeed()[0], seedFeed()[1]].map((r, i) => ({ ...r, runId: id, id: "r" + i }));
  return { run: { id, owner: HOUSE_OWNER, task: (events[0] as { task: string }).task, status: "done", answer: ANSWER, spentBase: "25000", isHouse: true, createdAt: Date.now() - 600000, finishedAt: Date.now() - 585000 }, events, receipts };
};

export const mockProof = async (remaining: string): Promise<ProofResult> => {
  await sleep(1200);
  return {
    attemptedBase: (BigInt(remaining) + 10000n).toString(), remainingBase: remaining, refused: true, code: 300, name: "amountExceedsLimit",
    plain: "The amount is more than what is left in this petty cash.", signature: sig(99),
    logs: ["Program De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44 invoke [1]", "Program log: Instruction: TransferFixed", "Program log: Error: AmountExceedsLimit", "Program De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44 failed: custom program error: 0x12c"],
  };
};
export const mockSleep = sleep;
