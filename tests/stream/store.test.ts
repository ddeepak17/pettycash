// Runs against the real database (the restricted pettycash role) when DATABASE_URL is available, in the environment
// or in .env.local. Every row it writes uses a random TEST signature, nonce or key and is deleted afterwards.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import bs58 from "bs58";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StreamMatch } from "../../src/lib/stream/match";
import { claimNonce, closeStore, findPaymentProof, getProofs, getSetting, recordDelivery, saveDeliveries, setSetting, toDeliveryRows } from "../../src/lib/stream/store";

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
const AGENT = address(), SELLER = address(), OWNER = address(), MINT = address();
const BASE_SLOT = 900_000_000_000 + Math.floor(Math.random() * 1_000_000) * 1000; // far above any real slot
const created = { signatures: [] as string[], nonces: [] as string[], keys: [] as string[], purchases: [] as string[] };

function match(over: Partial<StreamMatch> & { slot: number }): StreamMatch {
  const sig = signature();
  created.signatures.push(sig);
  return { signature: sig, blockTime: Math.floor(Date.now() / 1000) - 2, ok: true, err: null, feePayer: address(), version: 0, programs: [], allowances: false, allowanceIxs: [], memos: [],
    movements: [{ owner: AGENT, mint: MINT, deltaBase: "-1000" }, { owner: SELLER, mint: MINT, deltaBase: "1000" }], ...over };
}
const nonce = () => { const n = `test-${randomBytes(12).toString("hex")}`; created.nonces.push(n); return n; };

describe.skipIf(!url)("stream store (live database)", () => {
  let admin: ReturnType<typeof postgres>;
  beforeAll(() => { admin = postgres(url!, { prepare: false, max: 1 }); });
  afterAll(async () => {
    if (created.purchases.length) await admin`delete from purchases where id in ${admin(created.purchases)}`;
    if (created.signatures.length) await admin`delete from stream_deliveries where signature in ${admin(created.signatures)}`;
    if (created.nonces.length) await admin`delete from webhook_nonces where nonce in ${admin(created.nonces)}`;
    if (created.keys.length) await admin`delete from settings where key in ${admin(created.keys)}`;
    const [left] = await admin`select count(*)::int as n from stream_deliveries where signature like 'TEST%'`;
    await admin.end();
    await closeStore();
    expect(left.n).toBe(0);
  });

  it("saveDeliveries stores rows once: a second save of the same signature changes nothing", async () => {
    const m = match({ slot: BASE_SLOT + 1 });
    expect(await saveDeliveries(toDeliveryRows([m], "stream-a"))).toBe(1);
    const changed = { ...m, ok: false, movements: [] };
    expect(await saveDeliveries(toDeliveryRows([changed, changed], "stream-b"))).toBe(0);
    const [row] = await admin`select slot, block_time, ok, payload, stream_id from stream_deliveries where signature = ${m.signature}`;
    expect(Number(row.slot)).toBe(BASE_SLOT + 1);
    expect(row.ok).toBe(true);
    expect(row.stream_id).toBe("stream-a");
    expect(row.payload).toEqual(m);
    expect(await saveDeliveries([])).toBe(0);
  });

  it("claimNonce is true once, then false", async () => {
    const n = nonce();
    expect(await claimNonce(n)).toBe(true);
    expect(await claimNonce(n)).toBe(false);
  });

  it("recordDelivery claims the nonce and stores the rows together; a replayed nonce stores nothing", async () => {
    const n = nonce();
    const first = match({ slot: BASE_SLOT + 2 });
    expect(await recordDelivery(n, toDeliveryRows([first], null))).toEqual({ fresh: true, saved: 1 });
    const second = match({ slot: BASE_SLOT + 3 });
    expect(await recordDelivery(n, toDeliveryRows([second], null))).toEqual({ fresh: false, saved: 0 });
    expect((await getProofs([first.signature, second.signature])).size).toBe(1);
    // A fresh nonce with nothing to store is still claimed; one carrying an already stored transaction saves 0.
    expect(await recordDelivery(nonce(), [])).toEqual({ fresh: true, saved: 0 });
    expect(await recordDelivery(nonce(), toDeliveryRows([first], null))).toEqual({ fresh: true, saved: 0 });
  });

  it("recordDelivery consumes nothing when storing fails, so the retry is processed", async () => {
    const n = nonce();
    const bad = { ...match({ slot: BASE_SLOT + 4 }), slot: "not a number" as unknown as number };
    await expect(recordDelivery(n, toDeliveryRows([bad], null))).rejects.toThrow();
    expect(await claimNonce(n)).toBe(true);
  });

  it("getProofs returns what was delivered, with the delay from block time to receipt", async () => {
    const m = match({ slot: BASE_SLOT + 5, blockTime: Math.floor(Date.now() / 1000) - 60 });
    const failed = match({ slot: BASE_SLOT + 6, ok: false, err: { InstructionError: [0, { Custom: 300 }] }, movements: [], blockTime: null });
    await saveDeliveries(toDeliveryRows([m, failed], "s"));
    const missing = signature();
    const proofs = await getProofs([m.signature, failed.signature, missing, m.signature]);
    expect([...proofs.keys()].sort()).toEqual([m.signature, failed.signature].sort());
    const p = proofs.get(m.signature)!;
    expect(p).toMatchObject({ signature: m.signature, slot: BASE_SLOT + 5, blockTime: m.blockTime, ok: true, movements: m.movements });
    // The block time was set 60 s back; the database stamps the receipt with its own clock.
    expect(p.receivedAt).toBeGreaterThan(30_000);
    expect(p.receivedAt).toBeLessThan(180_000);
    expect(proofs.get(failed.signature)).toMatchObject({ ok: false, blockTime: null, receivedAt: 0, movements: [] });
    expect((await getProofs([])).size).toBe(0);
  });

  it("findPaymentProof finds the exact payment and nothing that only resembles it", async () => {
    const q = { agent: AGENT, payTo: SELLER, mint: MINT, amountBase: "2500", afterSlot: BASE_SLOT + 100 };
    const pay = (slot: number, over: Partial<StreamMatch> = {}) => match({ slot, movements: [{ owner: AGENT, mint: MINT, deltaBase: "-2500" }, { owner: SELLER, mint: MINT, deltaBase: "2500" }], ...over });
    const tooEarly = pay(BASE_SLOT + 100);
    const failed = pay(BASE_SLOT + 101, { ok: false });
    const wrongAmount = pay(BASE_SLOT + 102, { movements: [{ owner: AGENT, mint: MINT, deltaBase: "-2501" }, { owner: SELLER, mint: MINT, deltaBase: "2501" }] });
    const wrongSeller = pay(BASE_SLOT + 103, { movements: [{ owner: AGENT, mint: MINT, deltaBase: "-2500" }, { owner: OWNER, mint: MINT, deltaBase: "2500" }] });
    const wrongMint = pay(BASE_SLOT + 104, { movements: [{ owner: AGENT, mint: OWNER, deltaBase: "-2500" }, { owner: SELLER, mint: OWNER, deltaBase: "2500" }] });
    const notFromAgent = pay(BASE_SLOT + 105, { movements: [{ owner: OWNER, mint: MINT, deltaBase: "-2500" }, { owner: SELLER, mint: MINT, deltaBase: "2500" }] });
    await saveDeliveries(toDeliveryRows([tooEarly, failed, wrongAmount, wrongSeller, wrongMint, notFromAgent], null));
    expect(await findPaymentProof(q)).toBeNull();

    const second = pay(BASE_SLOT + 120, { memos: ["memo-second"] });
    const first = pay(BASE_SLOT + 110, { memos: ["memo-first"], movements: [{ owner: OWNER, mint: MINT, deltaBase: "7" }, { owner: AGENT, mint: MINT, deltaBase: "-2500" }, { owner: SELLER, mint: MINT, deltaBase: "2500" }] });
    await saveDeliveries(toDeliveryRows([second, first], null));
    expect((await findPaymentProof(q))?.signature).toBe(first.signature); // the earliest after afterSlot
    expect((await findPaymentProof({ ...q, afterSlot: BASE_SLOT + 110 }))?.signature).toBe(second.signature);
    expect((await findPaymentProof({ ...q, memo: "memo-second" }))?.signature).toBe(second.signature);
    expect(await findPaymentProof({ ...q, memo: "memo-unknown" })).toBeNull();
    expect((await findPaymentProof({ ...q, excludeSignatures: [first.signature] }))?.signature).toBe(second.signature);
    expect(await findPaymentProof({ ...q, afterSlot: BASE_SLOT + 120 })).toBeNull();
    expect(await findPaymentProof({ ...q, amountBase: "0" })).toBeNull();
    expect(await findPaymentProof({ ...q, amountBase: "2500; drop table" })).toBeNull();
    const found = await findPaymentProof(q);
    expect(found).toMatchObject({ slot: BASE_SLOT + 110, ok: true });
    expect(found!.movements).toEqual(first.movements);

    // One payment must not prove two receipts: once a purchase has recorded it as its pay_sig, it is skipped
    // for every other purchase, and still found for that purchase itself.
    const [purchase] = await admin`
      insert into purchases (owner, cluster, seller_url, seller_host, pay_to, mint, amount_base, quote, policy, status, pay_sig)
      values (${OWNER}, 'mainnet-beta', 'https://stream-test.invalid/x', 'stream-test.invalid', ${SELLER}, ${MINT}, 2500, '{}'::jsonb, '{}'::jsonb, 'paid', ${first.signature})
      returning id`;
    created.purchases.push(purchase.id);
    try {
      expect((await findPaymentProof(q))?.signature).toBe(second.signature);
      expect((await findPaymentProof({ ...q, purchaseId: purchase.id }))?.signature).toBe(first.signature);
      expect((await findPaymentProof({ ...q, purchaseId: "not-a-uuid" }))?.signature).toBe(second.signature);
    } finally {
      await admin`delete from purchases where id = ${purchase.id}`;
    }
  });

  it("settings round-trip and overwrite", async () => {
    const key = `stream_test_${randomBytes(6).toString("hex")}`;
    created.keys.push(key);
    expect(await getSetting(key)).toBeNull();
    await setSetting(key, { at: "2026-11-20T00:00:00.000Z" });
    await setSetting(key, { at: "2026-11-20T01:00:00.000Z" });
    const row = await getSetting<{ at: string }>(key);
    expect(row?.value).toEqual({ at: "2026-11-20T01:00:00.000Z" });
    expect(Math.abs(Date.now() - row!.updatedAt)).toBeLessThan(120_000);
  });
});
