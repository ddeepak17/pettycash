import { describe, expect, it } from "vitest";
import { decide, type PolicyInput } from "../../src/lib/agent/policy";

const NET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", SELLER = "46vMcwuC4sK11sB3gkLhyA7J7GEwfkhn5rFyDtihBwqe";
const base = (over: Partial<{ offer: Partial<PolicyInput["offer"]>; seller: PolicyInput["expected"]["seller"]; limits: Partial<PolicyInput["limits"]>; state: Partial<PolicyInput["state"]> }> = {}): PolicyInput => ({
  offer: { scheme: "exact", network: NET, asset: USDC, payTo: SELLER, amount: 1000n, ...over.offer },
  expected: { network: NET, asset: USDC, seller: over.seller === undefined ? { name: "Minifetch", payTo: SELLER, maxPrice: 5000n } : over.seller },
  limits: { perPurchaseMax: 50_000n, approvalThreshold: 10_000n, runBudget: 250_000n, ...over.limits },
  state: { spentInRun: 0n, allowanceRemaining: 1_000_000n, allowanceExpired: false, ...over.state },
});

describe("rule check", () => {
  it("allows a small purchase from a known seller at its usual price", () => {
    const d = decide(base());
    expect(d.decision).toBe("allow");
    expect(d.checks.every((c) => c.pass)).toBe(true);
  });
  it("denies a different network", () => expect(decide(base({ offer: { network: "eip155:8453" } })).decision).toBe("deny"));
  it("denies a different token", () => expect(decide(base({ offer: { asset: "So11111111111111111111111111111111111111112" } })).decision).toBe("deny"));
  it("denies a scheme that is not a fixed price", () => expect(decide(base({ offer: { scheme: "upto" } })).decision).toBe("deny"));
  it("denies an unknown seller", () => expect(decide(base({ seller: null })).decision).toBe("deny"));
  it("denies a zero price", () => expect(decide(base({ offer: { amount: 0n } })).decision).toBe("deny"));
  it("denies above the per-purchase ceiling even if the petty cash could pay", () => {
    const d = decide(base({ offer: { amount: 60_000n }, seller: { name: "X", payTo: SELLER, maxPrice: 100_000n } }));
    expect(d.decision).toBe("deny");
    expect(d.reason).toMatch(/ceiling/);
  });
  it("denies when the errand budget would be exceeded", () => expect(decide(base({ state: { spentInRun: 249_500n } })).decision).toBe("deny"));
  it("denies when the petty cash has less left than the price", () => expect(decide(base({ state: { allowanceRemaining: 999n } })).decision).toBe("deny"));
  it("denies when the petty cash expired", () => expect(decide(base({ state: { allowanceExpired: true } })).decision).toBe("deny"));
  it("denies when the petty cash was revoked", () => {
    const d = decide(base({ state: { allowanceMissing: true, allowanceRemaining: 0n } }));
    expect(d.decision).toBe("deny");
    expect(d.reason).toMatch(/no longer exists/);
  });
  it("asks a person when the seller wants to be paid at a different wallet", () => {
    const d = decide(base({ offer: { payTo: "9MkM5Ra48KFcSv9HDQ8sb3C3r5HjouEwGQ6sp1cx1vde" } }));
    expect(d.decision).toBe("ask");
    expect(d.reason).toMatch(/different wallet/);
  });
  it("asks a person when the price is above the seller's usual price", () => expect(decide(base({ offer: { amount: 6000n } })).decision).toBe("ask"));
  it("asks a person above the ask-first line", () => {
    const d = decide(base({ offer: { amount: 30_000n }, seller: { name: "Images", payTo: SELLER, maxPrice: 30_000n } }));
    expect(d.decision).toBe("ask");
  });
  it("always asks for sellers marked ask-first, even when cheap", () => expect(decide(base({ seller: { name: "Images", payTo: SELLER, maxPrice: 5000n, alwaysAsk: true } })).decision).toBe("ask"));
  it("a deny reason wins over an ask reason", () => {
    const d = decide(base({ offer: { amount: 60_000n, payTo: "9MkM5Ra48KFcSv9HDQ8sb3C3r5HjouEwGQ6sp1cx1vde" } }));
    expect(d.decision).toBe("deny");
  });
  it("exactly at each limit is allowed", () => {
    const d = decide(base({ offer: { amount: 10_000n }, seller: { name: "X", payTo: SELLER, maxPrice: 10_000n }, limits: { runBudget: 10_000n }, state: { allowanceRemaining: 10_000n } }));
    expect(d.decision).toBe("allow");
  });
});
