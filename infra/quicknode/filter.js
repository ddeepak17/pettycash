// Petty Cash: QuickNode Streams filter. Network "solana-mainnet", dataset "block" (one full block per call).
//
// Reports every transaction whose account keys include the agent's public key, as one compact object:
//   { signature, slot, blockTime, ok, err, feePayer, version, programs: [...], allowances, allowanceIxs: [...],
//     memos: [...], movements: [{ owner, mint, deltaBase }] }
// deltaBase = (sum of post token balances) - (sum of pre token balances) for that owner wallet and mint, as a
// decimal string in base units. One entry per (owner, mint) whose balance changed; negative means paid out.
// Returns null when no transaction matches, so QuickNode delivers nothing for that block.
//
// Runs in QuickNode's sandbox: plain JavaScript, no imports, no network. Entry point: main(stream).
// scripts/stream.ts replaces the AGENT line below with AGENT_PUBLIC_KEY from the environment when it uploads.
/* eslint-disable @typescript-eslint/no-unused-vars */
const AGENT = "5SAtLdgB7VnhbTBJGjKs4HkYKNjPC4Dnhx6FLVu4Jtz9";

const ALLOWANCES_PROGRAM = "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44";
const MEMO_PROGRAMS = ["MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo"];

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** base58 string -> array of bytes, or null when the text is not base58. */
function b58decode(text) {
  if (typeof text !== "string") return null;
  const bytes = [];
  for (let i = 0; i < text.length; i++) {
    let carry = B58.indexOf(text[i]);
    if (carry < 0) return null;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let k = 0; k < text.length && text[k] === "1"; k++) bytes.push(0);
  return bytes.reverse();
}

/** UTF-8 bytes -> string (the sandbox is not guaranteed to have TextDecoder). */
function utf8(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    let cp = 0xfffd;
    let n = 1;
    if (b < 0x80) cp = b;
    else if (b >= 0xc2 && b < 0xe0 && i + 1 < bytes.length) { cp = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f); n = 2; }
    else if (b >= 0xe0 && b < 0xf0 && i + 2 < bytes.length) { cp = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f); n = 3; }
    else if (b >= 0xf0 && b < 0xf5 && i + 3 < bytes.length) { cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f); n = 4; }
    out += String.fromCodePoint(cp > 0x10ffff ? 0xfffd : cp);
    i += n;
  }
  return out;
}

/** Account keys arrive as strings (raw encoding) or as { pubkey, signer, writable, source } objects (parsed). */
function keyOf(k) {
  if (typeof k === "string") return k;
  return k && typeof k.pubkey === "string" ? k.pubkey : "";
}

/** Every account the transaction touches, in index order: the static keys, then (version-0 transactions in raw
 *  encoding) the addresses loaded from lookup tables. The parsed encoding already lists those in accountKeys. */
function accountKeys(tx) {
  const message = (tx.transaction && tx.transaction.message) || {};
  const listed = message.accountKeys || [];
  const keys = listed.map(keyOf);
  const loaded = tx.meta && tx.meta.loadedAddresses;
  const alreadyListed = listed.some(function (k) { return k && typeof k === "object" && k.source === "lookupTable"; });
  if (loaded && !alreadyListed) {
    for (const k of loaded.writable || []) keys.push(keyOf(k));
    for (const k of loaded.readonly || []) keys.push(keyOf(k));
  }
  return keys;
}

/** Top-level instructions followed by the inner (cross-program) ones. */
function allInstructions(tx) {
  const message = (tx.transaction && tx.transaction.message) || {};
  const out = (message.instructions || []).slice();
  for (const group of (tx.meta && tx.meta.innerInstructions) || []) {
    for (const ix of (group && group.instructions) || []) out.push(ix);
  }
  return out;
}

function programOf(ix, keys) {
  if (ix && typeof ix.programId === "string") return ix.programId;
  if (ix && typeof ix.programIdIndex === "number") return keys[ix.programIdIndex] || "";
  return "";
}

/** Net token change per (owner wallet, mint). A token account missing on one side counts as zero there, so
 *  accounts opened or closed inside the transaction are handled. Throws on a balance it cannot read. */
function tokenMovements(meta) {
  const sums = new Map();
  function add(list, sign) {
    for (const b of list || []) {
      const amount = b && b.uiTokenAmount && b.uiTokenAmount.amount;
      if (typeof amount !== "string" || !/^[0-9]+$/.test(amount)) throw new Error("unreadable token balance");
      if (typeof b.owner !== "string" || typeof b.mint !== "string") throw new Error("token balance without owner or mint");
      const id = b.owner + "|" + b.mint;
      if (!sums.has(id)) sums.set(id, { owner: b.owner, mint: b.mint, delta: 0n });
      sums.get(id).delta += sign * BigInt(amount);
    }
  }
  add(meta.preTokenBalances, -1n);
  add(meta.postTokenBalances, 1n);
  const out = [];
  sums.forEach(function (s) {
    if (s.delta !== 0n) out.push({ owner: s.owner, mint: s.mint, deltaBase: s.delta.toString() });
  });
  return out;
}

function describe(tx, block, keys) {
  const meta = tx.meta || null;
  const programs = [];
  const memos = [];
  const allowanceIxs = [];
  for (const ix of allInstructions(tx)) {
    const program = programOf(ix, keys);
    if (!program) continue;
    if (programs.indexOf(program) < 0) programs.push(program);
    if (program === ALLOWANCES_PROGRAM) {
      const data = b58decode(ix.data);
      if (data && data.length) allowanceIxs.push(data[0]);
    }
    if (MEMO_PROGRAMS.indexOf(program) >= 0) {
      if (typeof ix.parsed === "string") memos.push(ix.parsed);
      else { const data = b58decode(ix.data); if (data) memos.push(utf8(data)); }
    }
  }

  // Without the execution result there is no proof of anything: report the transaction as not successful.
  let ok = false;
  let err = "no execution result in the block data";
  let movements = [];
  let balanceError = false;
  if (meta) {
    const failed = meta.err !== null && meta.err !== undefined;
    const statusFailed = !!(meta.status && typeof meta.status === "object" && "Err" in meta.status);
    ok = !failed && !statusFailed;
    err = ok ? null : (failed ? meta.err : meta.status.Err);
    try { movements = tokenMovements(meta); } catch (e) { movements = []; balanceError = true; }
  }

  const signatures = (tx.transaction && tx.transaction.signatures) || [];
  const match = {
    signature: signatures[0] || null,
    slot: typeof block.slot === "number" ? block.slot : null,
    blockTime: typeof block.blockTime === "number" ? block.blockTime : null,
    ok: ok,
    err: err,
    feePayer: keys[0] || null,
    version: tx.version === undefined ? null : tx.version,
    programs: programs,
    allowances: programs.indexOf(ALLOWANCES_PROGRAM) >= 0,
    allowanceIxs: allowanceIxs,
    memos: memos,
    movements: movements,
  };
  if (balanceError) match.balanceError = true;
  return match;
}

function main(stream) {
  const data = stream && stream.data;
  const metadata = (stream && stream.metadata) || {};
  const blocks = [];
  for (const item of Array.isArray(data) ? data : data ? [data] : []) {
    if (Array.isArray(item)) { for (const b of item) blocks.push(b); } else blocks.push(item);
  }

  const matches = [];
  for (const block of blocks) {
    if (!block || !Array.isArray(block.transactions)) continue;
    for (const tx of block.transactions) {
      if (!tx || !tx.transaction) continue;
      const keys = accountKeys(tx);
      if (keys.indexOf(AGENT) < 0) continue;
      const match = describe(tx, block, keys);
      // A block-level slot can be absent in some encodings; with one block per batch the batch range is that slot.
      if (match.slot === null && blocks.length === 1 && typeof metadata.batch_start_range === "number" && metadata.batch_start_range === metadata.batch_end_range) match.slot = metadata.batch_start_range;
      matches.push(match);
    }
  }
  if (!matches.length) return null;
  return {
    pettycash: 1,
    agent: AGENT,
    network: typeof metadata.network === "string" ? metadata.network : null,
    streamId: typeof metadata.stream_id === "string" ? metadata.stream_id : null,
    matches: matches,
  };
}
