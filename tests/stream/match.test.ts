import { describe, expect, it } from "vitest";
import type { StreamProof } from "../../src/lib/types";
import { checkReceipt, parseStreamBody, toStreamMatch } from "../../src/lib/stream/match";

const AGENT = "5SAtLdgB7VnhbTBJGjKs4HkYKNjPC4Dnhx6FLVu4Jtz9";
const SELLER = "7r4e5dwNS68MDaxbw7N8jbzHq7RCMBp9z6smHFH4NXWw";
const OWNER = "96Ly1bNBQgKRNPZv3ZNXCr3mxb7M4QH8Cyr6XGKMxSje";
const STRANGER = "GgR1Qn7i5tsxp1bKqXt4y96RHMkTbBjrmmf4GAuzuTwt";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const SIG = "2G38it8REW3Uvh6piEFL1P4jGCZXPC1tQ8F6jDhiwPGj7x16h8QBDw3yymDRNye1BSioVjyFEZkrUajSkdjcjAnH";

const mv = (owner: string, deltaBase: string, mint = USDC) => ({ owner, mint, deltaBase });
const proof = (movements: StreamProof["movements"], ok = true): StreamProof => ({ signature: SIG, slot: 471671101, blockTime: 1795163481, ok, receivedAt: 900, movements });
const payment = { kind: "payment" as const, agent: AGENT, payTo: SELLER, mint: USDC, amountBase: "1000" };
const pull = { kind: "pull" as const, agent: AGENT, owner: OWNER, mint: USDC, amountBase: "1000" };

describe("checkReceipt: payment", () => {
  it("is verified when the seller gained and the agent lost exactly the quoted amount", () => {
    expect(checkReceipt(proof([mv(AGENT, "-1000"), mv(SELLER, "1000")]), payment)).toEqual({ verified: true, mismatch: null });
  });

  it("is not verified, and not a mismatch, while the Stream has delivered nothing", () => {
    expect(checkReceipt(null, payment)).toEqual({ verified: false, mismatch: null });
    expect(checkReceipt(undefined, payment)).toEqual({ verified: false, mismatch: null });
  });

  it("rejects a failed transaction even when its movements look right", () => {
    expect(checkReceipt(proof([mv(AGENT, "-1000"), mv(SELLER, "1000")], false), payment)).toEqual({ verified: false, mismatch: "The transaction failed on chain, so no money moved." });
    expect(checkReceipt(proof([], false), payment).verified).toBe(false);
  });

  it("rejects a wrong amount, in either direction, and says both numbers", () => {
    expect(checkReceipt(proof([mv(AGENT, "-900"), mv(SELLER, "900")]), payment)).toEqual({ verified: false, mismatch: "The seller received $0.0009, but the expected amount was $0.001." });
    expect(checkReceipt(proof([mv(AGENT, "-1001"), mv(SELLER, "1001")]), payment).mismatch).toBe("The seller received $0.001001, but the expected amount was $0.001.");
  });

  it("rejects a payment to a different wallet", () => {
    expect(checkReceipt(proof([mv(AGENT, "-1000"), mv(STRANGER, "1000")]), payment)).toEqual({ verified: false, mismatch: "The money went to a different wallet, not to the seller." });
  });

  it("rejects a payment in a different token", () => {
    expect(checkReceipt(proof([mv(AGENT, "-1000", USDT), mv(SELLER, "1000", USDT)]), payment)).toEqual({ verified: false, mismatch: "The seller was paid in a different token than the expected one." });
  });

  it("rejects when the seller was paid the right amount by someone other than the agent", () => {
    expect(checkReceipt(proof([mv(STRANGER, "-1000"), mv(SELLER, "1000")]), payment)).toEqual({ verified: false, mismatch: "The agent did not pay this amount: the money came from somewhere else." });
  });

  it("rejects when the agent paid more than the seller received", () => {
    expect(checkReceipt(proof([mv(AGENT, "-1500"), mv(SELLER, "1000"), mv(STRANGER, "500")]), payment)).toEqual({ verified: false, mismatch: "The agent paid $0.0015, but the expected amount was $0.001." });
  });

  it("rejects a transaction with no token movements at all", () => {
    expect(checkReceipt(proof([]), payment)).toEqual({ verified: false, mismatch: "The seller received nothing in this transaction." });
  });

  it("rejects a reversed transfer", () => {
    expect(checkReceipt(proof([mv(AGENT, "1000"), mv(SELLER, "-1000")]), payment).mismatch).toBe("The seller ended up with less of the token, not more.");
  });

  it("ignores unrelated movements of other wallets and other tokens", () => {
    const busy = proof([mv(STRANGER, "-777"), mv(OWNER, "777"), mv(AGENT, "-1000"), mv(STRANGER, "5", USDT), mv(OWNER, "-5", USDT), mv(SELLER, "1000")]);
    expect(checkReceipt(busy, payment)).toEqual({ verified: true, mismatch: null });
  });

  it("adds up split entries for the same wallet and token", () => {
    expect(checkReceipt(proof([mv(AGENT, "-400"), mv(AGENT, "-600"), mv(SELLER, "1000")]), payment).verified).toBe(true);
  });

  it("compares amounts exactly beyond 2^53", () => {
    const big = { ...payment, amountBase: "9007199254740993" };
    expect(checkReceipt(proof([mv(AGENT, "-9007199254740993"), mv(SELLER, "9007199254740993")]), big).verified).toBe(true);
    expect(checkReceipt(proof([mv(AGENT, "-9007199254740992"), mv(SELLER, "9007199254740992")]), big).verified).toBe(false);
  });

  it("refuses to check against an amount that is not a positive whole number", () => {
    for (const amountBase of ["0", "-1000", "1000.0", "", "1e3", " 1000"]) {
      expect(checkReceipt(proof([mv(AGENT, "-1000"), mv(SELLER, "1000")]), { ...payment, amountBase }).verified).toBe(false);
    }
  });

  it("refuses when the seller's wallet is the agent's own", () => {
    expect(checkReceipt(proof([mv(AGENT, "1000")]), { ...payment, payTo: AGENT }).verified).toBe(false);
  });

  it("does not trust a record it cannot read", () => {
    expect(checkReceipt(proof([mv(AGENT, "-1000"), mv(SELLER, "1e3")]), payment)).toEqual({ verified: false, mismatch: "The Stream's record of this transaction could not be read." });
    expect(checkReceipt({ ...proof([]), ok: "true" as unknown as boolean }, payment).verified).toBe(false);
  });

  it("names amounts of other tokens in base units", () => {
    expect(checkReceipt(proof([mv(AGENT, "-5", USDT), mv(SELLER, "5", USDT)]), { ...payment, mint: USDT, amountBase: "6" }).mismatch).toBe("The seller received 5 base units of the token, but the expected amount was 6 base units of the token.");
  });
});

describe("checkReceipt: pull", () => {
  it("is verified when the owner lost and the agent gained exactly the amount", () => {
    expect(checkReceipt(proof([mv(OWNER, "-1000"), mv(AGENT, "1000")]), pull)).toEqual({ verified: true, mismatch: null });
  });

  it("rejects a failed pull (the chain refused it)", () => {
    expect(checkReceipt(proof([], false), pull).mismatch).toBe("The transaction failed on chain, so no money moved.");
  });

  it("rejects a wrong amount", () => {
    expect(checkReceipt(proof([mv(OWNER, "-2000"), mv(AGENT, "2000")]), pull).mismatch).toBe("The agent received $0.002, but the expected amount was $0.001.");
  });

  it("rejects a pull that landed in a different wallet", () => {
    expect(checkReceipt(proof([mv(OWNER, "-1000"), mv(STRANGER, "1000")]), pull).mismatch).toBe("The money went to a different wallet, not to the agent.");
  });

  it("rejects a pull taken from a different owner", () => {
    expect(checkReceipt(proof([mv(STRANGER, "-1000"), mv(AGENT, "1000")]), pull).mismatch).toBe("The owner's wallet did not pay this amount: the money came from somewhere else.");
  });

  it("rejects when more left the owner than reached the agent", () => {
    expect(checkReceipt(proof([mv(OWNER, "-1200"), mv(AGENT, "1000"), mv(STRANGER, "200")]), pull).mismatch).toBe("The owner's wallet paid $0.0012, but the expected amount was $0.001.");
  });

  it("rejects a different token and ignores unrelated movements", () => {
    expect(checkReceipt(proof([mv(OWNER, "-1000", USDT), mv(AGENT, "1000", USDT)]), pull).mismatch).toBe("The agent was paid in a different token than the expected one.");
    expect(checkReceipt(proof([mv(OWNER, "-1000"), mv(AGENT, "1000"), mv(STRANGER, "-3"), mv(SELLER, "3")]), pull).verified).toBe(true);
  });

  it("a payment proof does not verify a pull, and the reverse", () => {
    expect(checkReceipt(proof([mv(AGENT, "-1000"), mv(SELLER, "1000")]), pull).verified).toBe(false);
    expect(checkReceipt(proof([mv(OWNER, "-1000"), mv(AGENT, "1000")]), payment).verified).toBe(false);
  });
});

describe("parseStreamBody", () => {
  const match = { signature: SIG, slot: 471671101, blockTime: 1795163481, ok: true, err: null, feePayer: STRANGER, version: 0, programs: ["p"], allowances: false, allowanceIxs: [], memos: ["m"], movements: [mv(AGENT, "-1000"), mv(SELLER, "1000")] };
  const other = { ...match, signature: SIG.replace(/^2G/, "3H"), slot: 471671102 };

  it("reads the filter's envelope", () => {
    const parsed = parseStreamBody({ pettycash: 1, agent: AGENT, network: "solana-mainnet", streamId: "abc", matches: [match, other] });
    expect(parsed).toMatchObject({ streamId: "abc", network: "solana-mainnet", skipped: 0 });
    expect(parsed.matches).toEqual([match, other]);
  });

  it("reads a single object, an array, and QuickNode's data/metadata wrapper", () => {
    expect(parseStreamBody(match).matches).toEqual([match]);
    expect(parseStreamBody([match, other]).matches).toHaveLength(2);
    const wrapped = parseStreamBody({ data: [{ pettycash: 1, matches: [match] }, [other]], metadata: { stream_id: "s-1", network: "solana-mainnet" } });
    expect(wrapped.matches).toHaveLength(2);
    expect(wrapped.streamId).toBe("s-1");
  });

  it("keeps one entry per signature", () => {
    expect(parseStreamBody([match, match, { matches: [match] }]).matches).toHaveLength(1);
  });

  it("rejects entries the verification could not rely on, and counts them", () => {
    const bad = [
      { ...match, signature: "short" },
      { ...match, slot: "471671101" },
      { ...match, slot: -1 },
      { ...match, ok: "true" },
      { ...match, ok: undefined },
      { ...match, movements: undefined },
      { ...match, movements: [{ owner: AGENT, mint: USDC, deltaBase: 1000 }] },
      { ...match, movements: [{ owner: AGENT, mint: USDC, deltaBase: "1.5" }] },
      { ...match, movements: [{ owner: "not an address", mint: USDC, deltaBase: "1" }] },
      { ...match, blockTime: "soon" },
    ];
    const parsed = parseStreamBody({ matches: [...bad, other] });
    expect(parsed.skipped).toBe(bad.length);
    expect(parsed.matches).toEqual([other]);
    for (const b of bad) expect(toStreamMatch(b)).toBeNull();
  });

  it("returns nothing for bodies that hold no transactions", () => {
    for (const body of [null, undefined, "hello", 7, [], {}, { matches: [] }, { data: null }, { message: "ping" }]) {
      expect(parseStreamBody(body)).toEqual({ matches: [], streamId: null, network: null, skipped: 0 });
    }
  });

  it("fills the optional fields with safe defaults", () => {
    const m = toStreamMatch({ signature: SIG, slot: 5, ok: false, movements: [] });
    expect(m).toEqual({ signature: SIG, slot: 5, blockTime: null, ok: false, err: null, feePayer: null, version: null, programs: [], allowances: false, allowanceIxs: [], memos: [], movements: [] });
  });
});
