// Runs infra/quicknode/filter.js the way QuickNode does: plain script, no imports, entry point main(stream).
// Two fixtures are real mainnet transactions exactly as getTransaction (jsonParsed) returned them; the expected
// movements are read from their own pre and post token balances.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import bs58 from "bs58";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(fileURLToPath(new URL("../../infra/quicknode/filter.js", import.meta.url)), "utf8");
const fixture = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8"));

const AGENT = "5SAtLdgB7VnhbTBJGjKs4HkYKNjPC4Dnhx6FLVu4Jtz9";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const ALLOWANCES = "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const BUDGET = "ComputeBudget111111111111111111111111111111";
const FACILITATOR = "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4";
const SELLER = "7r4e5dwNS68MDaxbw7N8jbzHq7RCMBp9z6smHFH4NXWw";
const OWNER = "96Ly1bNBQgKRNPZv3ZNXCr3mxb7M4QH8Cyr6XGKMxSje";
const AGENT_ATA = "6DWxSsoMK3jxry6Z599ubeQTUoHyq3pdNDYt3NCDFJrY";
const SELLER_ATA = "UXva6DWoRiNmwWtXHAmXXqjtpS1cnwfFPk1KSEnCDyS";
const OWNER_ATA = "ANdn2S4mrJUY4XPmPkTaPfoaEGn9ZXd3AEZV953bzVYY";
/** Instruction data as the chain encodes it: base58 of the raw bytes. */
const data = (...bytes: number[]) => bs58.encode(Uint8Array.from(bytes));
const PULL_DATA = data(5, 0xfb, 0x05, 0, 0, 0, 0, 0, 0, 7, 7, 7); // discriminator 5 (recurring pull), amount 1531, ...
const EVENT_DATA = data(228, 69, 165, 46, 81, 203, 154, 29, 1, 2, 3); // the program's call to itself that emits its event
const TOKEN_DATA = data(12, 0xfb, 0x05, 0, 0, 0, 0, 0, 0, 6);
const SIG = (n: number) => `${n}`.repeat(88).slice(0, 88).replace(/0/g, "A");

/* eslint-disable @typescript-eslint/no-explicit-any */
function runFilter(stream: unknown, agent?: string): any {
  const source = agent ? SOURCE.replace(/^const AGENT = "[^"]+";$/m, `const AGENT = "${agent}";`) : SOURCE;
  const sandbox = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(source, sandbox, { timeout: 2000 });
  // QuickNode serialises the return value; do the same so only JSON-safe output passes.
  return JSON.parse(vm.runInContext(`JSON.stringify(main(${JSON.stringify(stream)}))`, sandbox, { timeout: 2000 }) ?? "null");
}

const bal = (accountIndex: number, owner: string, amount: string, mint = USDC) => ({ accountIndex, mint, owner, programId: TOKEN, uiTokenAmount: { amount, decimals: 6, uiAmount: Number(amount) / 1e6, uiAmountString: "" } });
const block = (slot: number, transactions: unknown[], blockTime: number | null = 1_795_000_000) => ({ slot, blockTime, blockHeight: slot - 1, parentSlot: slot - 1, transactions });
const batch = (...blocks: unknown[]) => ({ data: blocks, metadata: { network: "solana-mainnet", dataset: "block", stream_id: "stream-123", batch_start_range: 1, batch_end_range: 1 } });

/** The payment as the "block" dataset delivers it (parsed encoding): object account keys, programId on instructions. */
function parsedPayment(opts: { signature?: string; err?: unknown; payer?: string } = {}) {
  const payer = opts.payer ?? AGENT;
  return {
    version: 0,
    transaction: {
      signatures: [opts.signature ?? SIG(1), SIG(9)],
      message: {
        accountKeys: [
          { pubkey: FACILITATOR, signer: true, writable: true, source: "transaction" },
          { pubkey: payer, signer: true, writable: false, source: "transaction" },
          { pubkey: AGENT_ATA, signer: false, writable: true, source: "transaction" },
          { pubkey: SELLER_ATA, signer: false, writable: true, source: "transaction" },
          { pubkey: BUDGET, signer: false, writable: false, source: "transaction" },
          { pubkey: USDC, signer: false, writable: false, source: "transaction" },
          { pubkey: MEMO, signer: false, writable: false, source: "transaction" },
          { pubkey: TOKEN, signer: false, writable: false, source: "transaction" },
        ],
        instructions: [
          { programId: BUDGET, accounts: [], data: "EuxTsD", stackHeight: 1 },
          { programId: BUDGET, accounts: [], data: "3DdGGhkhJbjm", stackHeight: 1 },
          { program: "spl-token", programId: TOKEN, parsed: { type: "transferChecked", info: { authority: payer, source: AGENT_ATA, destination: SELLER_ATA, mint: USDC, tokenAmount: { amount: "1000", decimals: 6 } } }, stackHeight: 1 },
          { program: "spl-memo", programId: MEMO, parsed: "order-42", stackHeight: 1 },
        ],
      },
    },
    meta: {
      err: opts.err ?? null,
      status: opts.err ? { Err: opts.err } : { Ok: null },
      fee: 10001,
      innerInstructions: [],
      preTokenBalances: [bal(2, payer, "5000"), bal(3, SELLER, "70")],
      postTokenBalances: opts.err ? [bal(2, payer, "5000"), bal(3, SELLER, "70")] : [bal(2, payer, "4000"), bal(3, SELLER, "1070")],
    },
  };
}

/** The pull in RAW encoding: string keys, programIdIndex, base58 data, and a version-0 lookup table. */
function rawPull(agentInLookupTable = false) {
  const delegation = "3axhEEfMt5At3qR6WurPwDsmwk9MdS1tHVBNB9sRiyJp";
  const staticKeys = agentInLookupTable ? [FACILITATOR, delegation, OWNER_ATA, AGENT_ATA] : [AGENT, delegation, OWNER_ATA, AGENT_ATA];
  const loaded = { writable: [], readonly: agentInLookupTable ? [USDC, TOKEN, ALLOWANCES, AGENT] : [USDC, TOKEN, ALLOWANCES] };
  // combined index: 0..3 static, then readonly lookups -> USDC 4, TOKEN 5, ALLOWANCES 6
  return {
    version: 0,
    transaction: {
      signatures: [SIG(2)],
      message: {
        header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 0 },
        accountKeys: staticKeys,
        addressTableLookups: [{ accountKey: "8XYo2ERr5xsLhoSK7iH9kVpeecRQQfngMTxfq218GX8G", writableIndexes: [], readonlyIndexes: [0, 1, 2] }],
        instructions: [{ programIdIndex: 6, accounts: [1, 2, 3, 4, 5, 0], data: PULL_DATA, stackHeight: null }],
      },
    },
    meta: {
      err: null,
      status: { Ok: null },
      fee: 5000,
      loadedAddresses: loaded,
      innerInstructions: [{ index: 0, instructions: [{ programIdIndex: 5, accounts: [2, 4, 3, 1], data: TOKEN_DATA, stackHeight: 2 }] }],
      preTokenBalances: [bal(2, OWNER, "1001531"), bal(3, AGENT, "7763")],
      postTokenBalances: [bal(2, OWNER, "1000000"), bal(3, AGENT, "9294")],
    },
  };
}

describe("stream filter: real mainnet transactions", () => {
  it("payment (version 0, third-party fee payer, TransferChecked, Memo) reports exactly what the chain recorded", () => {
    const tx = fixture("payment-471671101.json");
    const payer = "5xoboHF74HbdWxAd4aBmNbQxVJ8Lwtr3M7Xx9wFfthPf";
    const out = runFilter(batch(block(tx.slot, [{ transaction: tx.transaction, meta: tx.meta, version: tx.version }], tx.blockTime)), payer);
    expect(out.matches).toHaveLength(1);
    const m = out.matches[0];
    expect(m).toMatchObject({
      signature: "2G38it8REW3Uvh6piEFL1P4jGCZXPC1tQ8F6jDhiwPGj7x16h8QBDw3yymDRNye1BSioVjyFEZkrUajSkdjcjAnH",
      slot: 471671101, blockTime: 1795163481, ok: true, err: null, feePayer: FACILITATOR, version: 0,
      programs: [BUDGET, TOKEN, MEMO], allowances: false, allowanceIxs: [], memos: ["90ac14fb29898a47dd15456105662742"],
    });
    // getTransaction: payer 347570523 -> 347560523, seller 380633400 -> 380643400
    expect(m.movements).toEqual([
      { owner: payer, mint: USDC, deltaBase: String(347560523 - 347570523) },
      { owner: SELLER, mint: USDC, deltaBase: String(380643400 - 380633400) },
    ]);
    expect(m.feePayer).not.toBe(payer);
  });

  it("allowance pull (Allowances program invoked through another program) reports owner out, spender in", () => {
    const tx = fixture("pull-471666304.json");
    const spender = "GgR1Qn7i5tsxp1bKqXt4y96RHMkTbBjrmmf4GAuzuTwt";
    const out = runFilter(batch(block(tx.slot, [{ transaction: tx.transaction, meta: tx.meta, version: tx.version }], tx.blockTime)), spender);
    const m = out.matches[0];
    expect(m).toMatchObject({ slot: 471666304, ok: true, version: "legacy", allowances: true, allowanceIxs: [5, 228], memos: [] });
    expect(m.programs).toContain(ALLOWANCES);
    // getTransaction: spender 7763 -> 9294, owner 1001531 -> 1000000
    expect(m.movements).toEqual([
      { owner: spender, mint: USDC, deltaBase: "1531" },
      { owner: OWNER, mint: USDC, deltaBase: "-1531" },
    ]);
  });
});

describe("stream filter: matching", () => {
  it("matches object-form account keys and returns the envelope", () => {
    const out = runFilter(batch(block(100, [parsedPayment()])));
    expect(out).toMatchObject({ pettycash: 1, agent: AGENT, network: "solana-mainnet", streamId: "stream-123" });
    expect(out.matches[0]).toMatchObject({ signature: SIG(1), slot: 100, feePayer: FACILITATOR, memos: ["order-42"], programs: [BUDGET, TOKEN, MEMO] });
    expect(out.matches[0].movements).toEqual([{ owner: AGENT, mint: USDC, deltaBase: "-1000" }, { owner: SELLER, mint: USDC, deltaBase: "1000" }]);
  });

  it("matches string-form account keys (raw encoding) and resolves programIdIndex through lookup tables", () => {
    const m = runFilter(batch(block(101, [rawPull()]))).matches[0];
    expect(m).toMatchObject({ signature: SIG(2), slot: 101, feePayer: AGENT, version: 0, allowances: true, allowanceIxs: [5], programs: [ALLOWANCES, TOKEN] });
    expect(m.movements).toEqual([{ owner: OWNER, mint: USDC, deltaBase: "-1531" }, { owner: AGENT, mint: USDC, deltaBase: "1531" }]);
  });

  it("matches a version-0 transaction that names the agent only through a lookup table", () => {
    const out = runFilter(batch(block(102, [rawPull(true)])));
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0].feePayer).toBe(FACILITATOR);
  });

  it("matches a parsed version-0 transaction whose agent key came from a lookup table", () => {
    const tx = parsedPayment({ payer: SELLER });
    tx.transaction.message.accountKeys.push({ pubkey: AGENT, signer: false, writable: false, source: "lookupTable" });
    expect(runFilter(batch(block(103, [tx]))).matches).toHaveLength(1);
  });

  it("returns null when no transaction names the agent, so nothing is delivered", () => {
    expect(runFilter(batch(block(104, [parsedPayment({ payer: SELLER })])))).toBeNull();
    expect(runFilter(batch(block(105, [])))).toBeNull();
    expect(runFilter({ data: [], metadata: {} })).toBeNull();
    expect(runFilter({ data: [null] })).toBeNull();
    expect(runFilter({})).toBeNull();
  });

  it("does not match a transaction where only a token account OWNED by the agent appears", () => {
    const tx = parsedPayment({ payer: SELLER });
    tx.meta.preTokenBalances = [bal(2, AGENT, "5"), bal(3, SELLER, "5")];
    tx.meta.postTokenBalances = [bal(2, AGENT, "6"), bal(3, SELLER, "4")];
    expect(runFilter(batch(block(106, [tx])))).toBeNull();
  });

  it("reports every matching transaction of every block in a batch, each with its own block's slot and time", () => {
    const other = parsedPayment({ payer: SELLER, signature: SIG(3) });
    const out = runFilter(batch(block(200, [other, parsedPayment({ signature: SIG(4) })], 1111), block(201, [other]), block(202, [parsedPayment({ signature: SIG(5) })], 2222)));
    expect(out.matches.map((m: any) => [m.signature, m.slot, m.blockTime])).toEqual([[SIG(4), 200, 1111], [SIG(5), 202, 2222]]);
  });

  it("accepts a batch whose blocks are nested one level deeper", () => {
    expect(runFilter({ data: [[block(300, [parsedPayment()])]], metadata: {} }).matches[0].slot).toBe(300);
  });

  it("the agent key is one constant that the CLI can replace", () => {
    expect(SOURCE.match(/^const AGENT = "[1-9A-HJ-NP-Za-km-z]{32,44}";$/gm)).toEqual([`const AGENT = "${AGENT}";`]);
    expect(runFilter(batch(block(107, [parsedPayment()])), SELLER)).toBeNull();
  });
});

describe("stream filter: what it reports", () => {
  it("a failed transaction is reported with ok=false, the chain's error, and no movements", () => {
    const err = { InstructionError: [2, { Custom: 1 }] };
    const m = runFilter(batch(block(400, [parsedPayment({ err })]))).matches[0];
    expect(m.ok).toBe(false);
    expect(m.err).toEqual(err);
    expect(m.movements).toEqual([]);
  });

  it("a transaction without an execution result is never reported as successful", () => {
    const tx: any = parsedPayment();
    tx.meta = null;
    const m = runFilter(batch(block(401, [tx]))).matches[0];
    expect(m.ok).toBe(false);
    expect(m.movements).toEqual([]);
  });

  it("sums several token accounts of one owner, and leaves out owners whose total did not change", () => {
    const tx = parsedPayment();
    tx.meta.preTokenBalances = [bal(2, AGENT, "5000"), bal(3, SELLER, "70"), bal(4, AGENT, "100"), bal(5, OWNER, "9"), bal(6, OWNER, "1")];
    tx.meta.postTokenBalances = [bal(2, AGENT, "4000"), bal(3, SELLER, "1170"), bal(4, AGENT, "0"), bal(5, OWNER, "1"), bal(6, OWNER, "9")];
    expect(runFilter(batch(block(402, [tx]))).matches[0].movements).toEqual([{ owner: AGENT, mint: USDC, deltaBase: "-1100" }, { owner: SELLER, mint: USDC, deltaBase: "1100" }]);
  });

  it("handles token accounts opened or closed inside the transaction, and keeps mints apart", () => {
    const OTHER_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
    const tx = parsedPayment();
    tx.meta.preTokenBalances = [bal(2, AGENT, "5000"), bal(7, AGENT, "33", OTHER_MINT)]; // 7 is closed, 3 does not exist yet
    tx.meta.postTokenBalances = [bal(2, AGENT, "4000"), bal(3, SELLER, "1000")];
    expect(runFilter(batch(block(403, [tx]))).matches[0].movements).toEqual([
      { owner: AGENT, mint: USDC, deltaBase: "-1000" },
      { owner: AGENT, mint: OTHER_MINT, deltaBase: "-33" },
      { owner: SELLER, mint: USDC, deltaBase: "1000" },
    ]);
  });

  it("follows a token account whose owner changed", () => {
    const tx = parsedPayment();
    tx.meta.preTokenBalances = [bal(2, AGENT, "500")];
    tx.meta.postTokenBalances = [bal(2, SELLER, "500")];
    expect(runFilter(batch(block(404, [tx]))).matches[0].movements).toEqual([{ owner: AGENT, mint: USDC, deltaBase: "-500" }, { owner: SELLER, mint: USDC, deltaBase: "500" }]);
  });

  it("is exact beyond 2^53", () => {
    const tx = parsedPayment();
    tx.meta.preTokenBalances = [bal(2, AGENT, "18446744073709551615"), bal(3, SELLER, "0")];
    tx.meta.postTokenBalances = [bal(2, AGENT, "9007199254740993"), bal(3, SELLER, "18437736874454810622")];
    expect(runFilter(batch(block(405, [tx]))).matches[0].movements).toEqual([
      { owner: AGENT, mint: USDC, deltaBase: "-18437736874454810622" },
      { owner: SELLER, mint: USDC, deltaBase: "18437736874454810622" },
    ]);
  });

  it("reports no movements, and says so, when a balance cannot be read", () => {
    const tx: any = parsedPayment();
    tx.meta.postTokenBalances[0].uiTokenAmount.amount = "4000.5";
    const m = runFilter(batch(block(406, [tx]))).matches[0];
    expect(m.movements).toEqual([]);
    expect(m.balanceError).toBe(true);
  });

  it("decodes a memo from raw base58 data, including non-ASCII text, and lists inner programs once", () => {
    const tx: any = rawPull();
    tx.transaction.message.accountKeys.push(MEMO); // static index 4 shifts the lookups by one
    tx.meta.loadedAddresses.readonly = [USDC, TOKEN, ALLOWANCES];
    tx.transaction.message.instructions = [
      { programIdIndex: 7, accounts: [1, 2, 3, 5, 6, 0], data: PULL_DATA },
      { programIdIndex: 4, accounts: [], data: bs58.encode(Buffer.from("café €1", "utf8")) },
    ];
    tx.meta.innerInstructions = [{ index: 0, instructions: [{ programIdIndex: 6, accounts: [], data: TOKEN_DATA }, { programIdIndex: 7, accounts: [], data: EVENT_DATA }] }];
    const m = runFilter(batch(block(407, [tx]))).matches[0];
    expect(m.memos).toEqual(["café €1"]);
    expect(m.programs).toEqual([ALLOWANCES, MEMO, TOKEN]);
    expect(m.allowanceIxs).toEqual([5, 228]);
  });
});
