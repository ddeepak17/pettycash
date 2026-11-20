// A refund may be sent by exactly one caller, and only that caller, looking at that same attempt, may give it back.
// This is the case the third review found: a reconciler working from an old copy of a row released a NEWER refund
// that was still in flight, and a second refund followed.
//
// Runs against the real database (the restricted pettycash role) when DATABASE_URL is available, in the environment
// or in .env.local. The one row it writes is marked cluster "test", which no reconciler reads, and is deleted afterwards.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import bs58 from "bs58";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

function databaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = fileURLToPath(new URL("../../.env.local", import.meta.url));
  if (!existsSync(file)) return undefined;
  const m = /^DATABASE_URL=(.+)$/m.exec(readFileSync(file, "utf8"));
  return m ? m[1].trim().replace(/^(["'])(.*)\1$/, "$2") : undefined;
}
const url = databaseUrl();
if (url) process.env.DATABASE_URL = url;

const address = () => bs58.encode(randomBytes(32));
const signature = () => `TEST${bs58.encode(randomBytes(64))}`.slice(0, 86);

describe.skipIf(!url)("refund claims (live database)", () => {
  let store: typeof import("../../src/lib/server/store");
  let id = "";
  const first = signature(), second = signature();
  let claimA = "", claimB = "";

  beforeAll(async () => {
    store = await import("../../src/lib/server/store");
    id = await store.insertPurchase({
      runId: null, owner: address(), cluster: "test", kind: "tool", toolId: "test", step: 1, sellerUrl: "https://seller.test/x", sellerHost: "seller.test",
      sellerName: "Test seller", method: "GET", payTo: address(), mint: address(), amountBase: 1000n, quote: {}, policy: {}, status: "refund_pending",
    });
  });
  afterAll(async () => {
    if (id) await store.sql()`delete from pettycash.purchases where id = ${id} and cluster = 'test'`;
    await store.closeStore();
  });
  const row = async () => (await store.getPurchase(id))!;

  it("gives the refund to one caller only", async () => {
    const claims = await Promise.all([store.claimRefund(id), store.claimRefund(id), store.claimRefund(id)]);
    const won = claims.filter((c): c is string => c !== null);
    expect(won).toHaveLength(1);
    claimA = won[0];
    expect((await row()).status).toBe("refunding");
  });

  it("records one attempt per claim, before anything is broadcast", async () => {
    expect(await store.recordRefundAttempt(id, claimA, first, 100)).toBe(true);
    expect(await store.recordRefundAttempt(id, claimA, signature(), 100)).toBe(false);
    expect((await row()).refund_try_sig).toBe(first);
  });

  it("does not release an attempt the caller did not see", async () => {
    // The caller thinks nothing was recorded yet, but an attempt is on record: it must not be released.
    expect(await store.releaseRefund(id, claimA, null)).toBe(false);
    expect(await store.releaseRefund(id, "00000000-0000-4000-8000-000000000000", first)).toBe(false);
    expect((await row()).status).toBe("refunding");
  });

  it("releases the attempt for the caller that saw exactly that attempt", async () => {
    expect(await store.releaseRefund(id, claimA, first)).toBe(true);
    const r = await row();
    expect(r.status).toBe("refund_pending");
    expect(r.refund_try_sig).toBeNull();
  });

  it("a stale copy of the row cannot release, or record over, a newer refund in flight", async () => {
    claimB = (await store.claimRefund(id))!;
    expect(claimB).toBeTruthy();
    expect(claimB).not.toBe(claimA);
    expect(await store.recordRefundAttempt(id, claimB, second, 200)).toBe(true);
    // Everything the earlier holder, or a reconciler holding the earlier copy of the row, could try:
    expect(await store.releaseRefund(id, claimA, first)).toBe(false);
    expect(await store.releaseRefund(id, claimA, null)).toBe(false);
    expect(await store.releaseRefund(id, claimB, null)).toBe(false);
    expect(await store.recordRefundAttempt(id, claimA, signature(), 300)).toBe(false);
    expect(await store.claimRefund(id)).toBeNull();
    const r = await row();
    expect(r.status).toBe("refunding");
    expect(r.refund_try_sig).toBe(second);
    expect(r.refund_claim).toBe(claimB);
  });

  it("once a refund is recorded as landed, nothing can reopen it", async () => {
    expect(await store.moveStatus(id, "refunding", "refunded", { refund_sig: second, unresolved_until: null })).toBe(true);
    expect(await store.releaseRefund(id, claimB, second)).toBe(false);
    expect(await store.claimRefund(id)).toBeNull();
    expect(await store.moveStatus(id, "refunded", "refund_pending")).toBe(false);
    expect((await row()).status).toBe("refunded");
  });
});
