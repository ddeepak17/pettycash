// x402 buyer: ask a seller for its price, then pay it with a Solana USDC transfer and collect what it returns.
//
// Two rules this file enforces on its own, without trusting the SDK or the seller:
//   1. We only ever pay the one offer that was quoted and checked by policy (network, token, recipient, amount).
//   2. Before a signed payment leaves this process we decode the transaction and refuse it unless it is exactly
//      one TransferChecked of the quoted amount from the agent's own token account to the quoted recipient,
//      with nothing else in it except compute-budget and memo instructions.
import { createHash } from "node:crypto";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";

export type Offer = { scheme: string; network: string; amount: string; asset: string; payTo: string; maxTimeoutSeconds?: number; extra?: Record<string, unknown> };

export type SellerRequest = { url: string; method: "GET" | "POST"; headers?: Record<string, string>; body?: string };

export type Quote = {
  request: SellerRequest;
  x402Version: number;
  /** The single offer we are willing to pay: scheme exact, our network, our token. */
  offer: Offer;
  /** Every offer the seller made, kept for the record. */
  offers: Offer[];
  description: string;
  serviceName: string | null;
  /** The parsed 402 exactly as the SDK read it. Needed to build the payment. */
  raw: unknown;
  quotedAt: number;
};

export type QuoteResult =
  | { kind: "quote"; quote: Quote }
  | { kind: "free"; status: number; body: string }
  | { kind: "error"; status: number | null; error: string };

export type PayResult = {
  /** True once the signed payment was put on the wire. After this point the outcome is the seller's to report. */
  sent: boolean;
  httpStatus: number | null;
  /** The seller's settlement report, when it sent one. */
  settled: boolean;
  signature: string | null;
  /** Random memo the SDK put in the payment transaction. Lets us find the transaction onchain if the seller never reports it. */
  memo: string | null;
  bodyText: string;
  bodyBytes: number;
  sha256: string | null;
  contentType: string | null;
  error: string | null;
  ms: number;
};

const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const MEMO_PROGRAMS = new Set(["MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo"]);
const MAX_BODY_BYTES = 6_000_000;

const normalizeOffer = (a: Record<string, unknown>): Offer => ({
  scheme: String(a.scheme ?? ""),
  network: String(a.network ?? ""),
  amount: String(a.amount ?? a.maxAmountRequired ?? ""),
  asset: String(a.asset ?? ""),
  payTo: String(a.payTo ?? ""),
  maxTimeoutSeconds: typeof a.maxTimeoutSeconds === "number" ? a.maxTimeoutSeconds : undefined,
  extra: (a.extra as Record<string, unknown>) ?? undefined,
});

/** Reads a response body without ever holding more than the cap in memory. A seller cannot exhaust the server by streaming forever. */
async function readCapped(res: Response): Promise<{ text: string; bytes: number; sha256: string; truncated: boolean }> {
  const hash = createHash("sha256");
  const chunks: Buffer[] = [];
  let bytes = 0, truncated = false;
  const reader = res.body?.getReader();
  if (reader) {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) { truncated = true; await reader.cancel().catch(() => {}); break; }
      hash.update(value);
      chunks.push(Buffer.from(value));
    }
  }
  return { text: Buffer.concat(chunks).toString("utf8"), bytes, sha256: hash.digest("hex"), truncated };
}

/** Step 1: an unpaid request. A compliant seller answers 402 with its offers. Nothing is signed or paid here. */
export async function getQuote(request: SellerRequest, want: { network: string; asset: string }, timeoutMs = 15_000): Promise<QuoteResult> {
  let res: Response;
  try {
    res = await fetch(request.url, {
      method: request.method,
      headers: { accept: "application/json", ...(request.body ? { "content-type": "application/json" } : {}), ...request.headers },
      body: request.body,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { kind: "error", status: null, error: `The seller did not answer${e instanceof Error && e.name === "TimeoutError" ? " in time" : ""}.` };
  }
  if (res.status !== 402) {
    const { text } = await readCapped(res);
    if (res.ok) return { kind: "free", status: res.status, body: text };
    return { kind: "error", status: res.status, error: `The seller answered HTTP ${res.status} instead of a price.` };
  }
  let body: unknown;
  try { body = JSON.parse((await readCapped(res)).text); } catch { body = undefined; }
  let parsed: { x402Version?: number; accepts?: unknown[]; resource?: unknown; error?: string };
  try {
    const http = new x402HTTPClient(new x402Client());
    parsed = http.getPaymentRequiredResponse((name) => res.headers.get(name), body) as typeof parsed;
  } catch (e) {
    return { kind: "error", status: 402, error: "The seller's price could not be read." };
  }
  const accepts = Array.isArray(parsed.accepts) ? (parsed.accepts as Record<string, unknown>[]) : [];
  const offers = accepts.map(normalizeOffer);
  const index = offers.findIndex((o) => o.scheme === "exact" && o.network === want.network && o.asset === want.asset && /^\d+$/.test(o.amount));
  if (index < 0) return { kind: "error", status: 402, error: "The seller does not accept USDC on this Solana network with a fixed price." };
  // The payment's memo must be ours and random: it is how an unclear payment is found onchain later.
  if (offers[index].extra && "memo" in offers[index].extra!) return { kind: "error", status: 402, error: "The seller asked for its own note on the payment, which Petty Cash does not allow." };
  if (typeof offers[index].extra?.feePayer !== "string") return { kind: "error", status: 402, error: "The seller's offer names nobody to pay the network fee, so the payment cannot be built." };
  const resource = (parsed.resource && typeof parsed.resource === "object" ? parsed.resource : {}) as Record<string, unknown>;
  const first = accepts[index];
  return {
    kind: "quote",
    quote: {
      request,
      x402Version: Number(parsed.x402Version ?? 2),
      offer: offers[index],
      offers,
      description: String(resource.description ?? first.description ?? ""),
      serviceName: resource.serviceName ? String(resource.serviceName) : null,
      // Keep only the chosen offer so the SDK cannot pick a different one.
      raw: { ...parsed, accepts: [accepts[index]] },
      quotedAt: Date.now(),
    },
  };
}

/** Thrown when a built payment is not exactly the quoted transfer. Its message is safe to show to a person. */
export class PaymentCheckError extends Error {}

/** Decodes a signed payment and throws unless it is exactly the transfer we agreed to. Returns the memo and the blockhash. */
export function assertPaymentIsExactlyTheQuote(transactionBase64: string, expected: { agent: PublicKey; payTo: PublicKey; mint: PublicKey; amount: bigint }): { memo: string | null; blockhash: string } {
  let tx: VersionedTransaction;
  try { tx = VersionedTransaction.deserialize(Buffer.from(transactionBase64, "base64")); } catch { throw new PaymentCheckError("payment could not be decoded"); }
  const msg = tx.message;
  if (msg.addressTableLookups.length > 0) throw new PaymentCheckError("payment uses address lookup tables, which we do not accept");
  const keys = msg.staticAccountKeys;
  const source = getAssociatedTokenAddressSync(expected.mint, expected.agent, true);
  const destination = getAssociatedTokenAddressSync(expected.mint, expected.payTo, true);
  let transfers = 0;
  let memo: string | null = null;
  for (const ix of msg.compiledInstructions) {
    const program = keys[ix.programIdIndex].toBase58();
    if (program === COMPUTE_BUDGET) continue;
    if (MEMO_PROGRAMS.has(program)) { memo = Buffer.from(ix.data).toString("utf8"); continue; }
    if (program !== TOKEN_PROGRAM_ID.toBase58()) throw new PaymentCheckError(`payment contains an instruction for an unexpected program (${program})`);
    const data = Buffer.from(ix.data);
    if (data[0] !== 12 || data.length !== 10) throw new PaymentCheckError("payment contains a token instruction that is not TransferChecked");
    const [src, mint, dst, authority] = ix.accountKeyIndexes.map((i) => keys[i]);
    if (ix.accountKeyIndexes.length !== 4) throw new PaymentCheckError("payment transfer has unexpected extra accounts");
    if (!src.equals(source)) throw new PaymentCheckError("payment does not come from the agent's own token account");
    if (!mint.equals(expected.mint)) throw new PaymentCheckError("payment is in a different token than quoted");
    if (!dst.equals(destination)) throw new PaymentCheckError("payment goes to a different recipient than quoted");
    if (!authority.equals(expected.agent)) throw new PaymentCheckError("payment is not authorised by the agent key");
    if (data.readBigUInt64LE(1) !== expected.amount) throw new PaymentCheckError("payment amount differs from the quote");
    transfers++;
  }
  if (transfers !== 1) throw new PaymentCheckError(`payment must contain exactly one transfer, found ${transfers}`);
  // The agent must be an ordinary signer and never the fee payer (the seller's facilitator pays the network fee).
  if (keys[0].equals(expected.agent)) throw new PaymentCheckError("payment would make the agent pay the network fee");
  return { memo, blockhash: msg.recentBlockhash };
}

/** A payment that has been built, signed and checked, but not sent. */
export type BuiltPayment = { headers: Record<string, string>; memo: string; blockhash: string };

// One scheme object per RPC endpoint is kept for the life of the process, so the token's details are fetched once
// instead of on every payment.
const schemes = new Map<string, ExactSvmScheme>();

/** Step 2: build and sign the quoted transfer, and check it. Nothing is sent and no balance is needed, so this runs
 *  BEFORE any money is pulled: if a payment cannot be built, no money ever moves.
 *  `rpcUrls` are tried in order: a rate-limited or failing endpoint is skipped rather than failing the purchase. */
export async function buildPayment(quote: Quote, agentSecretKey: Uint8Array, opts: { rpcUrls: string[]; mint: string }): Promise<{ ok: true; payment: BuiltPayment } | { ok: false; error: string }> {
  if (quote.x402Version !== 2) return { ok: false, error: "This seller uses an older version of the payment protocol that Petty Cash does not pay." };
  const signer = await createKeyPairSignerFromBytes(agentSecretKey);
  const net = quote.offer.network as `${string}:${string}`;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < opts.rpcUrls.length * 2; attempt++) {
    const rpcUrl = opts.rpcUrls[attempt % opts.rpcUrls.length];
    if (attempt >= opts.rpcUrls.length) await new Promise((r) => setTimeout(r, 400));
    try {
      let scheme = schemes.get(`${signer.address}|${rpcUrl}`);
      if (!scheme) { scheme = new ExactSvmScheme(signer, { rpcUrl }); schemes.set(`${signer.address}|${rpcUrl}`, scheme); }
      // A third, independent ceiling inside the SDK itself: this token on this network, never more than the quoted amount.
      const client = new x402Client().register(net, scheme).setSpendControls({ allowedAssets: [{ network: net, asset: opts.mint, maxAmountPerPayment: quote.offer.amount }] });
      const http = new x402HTTPClient(client);
      const payload = await http.createPaymentPayload(quote.raw as Parameters<typeof http.createPaymentPayload>[0]);
      const transaction = (payload as { payload?: { transaction?: string } }).payload?.transaction;
      if (typeof transaction !== "string") return { ok: false, error: "The payment could not be built in the expected form." };
      const { memo, blockhash } = assertPaymentIsExactlyTheQuote(transaction, {
        agent: new PublicKey(signer.address),
        payTo: new PublicKey(quote.offer.payTo),
        mint: new PublicKey(opts.mint),
        amount: BigInt(quote.offer.amount),
      });
      if (!memo || memo.length < 16) return { ok: false, error: "The payment has no unique note, so it could not be traced later. It was not sent." };
      return { ok: true, payment: { headers: http.encodePaymentSignatureHeader(payload), memo, blockhash } };
    } catch (e) {
      // Our own check failing is final. Anything else (usually a rate-limited RPC endpoint) is retried on the next endpoint.
      if (e instanceof PaymentCheckError) return { ok: false, error: `The payment was stopped by our own check: ${e.message}.` };
      lastError = e;
    }
  }
  console.error("payment build failed on every endpoint:", lastError instanceof Error ? lastError.message.slice(0, 200) : lastError);
  return { ok: false, error: "The payment could not be prepared because Solana could not be reached." };
}

/** Step 3: send the request again with the signed payment attached, and collect the result. */
export async function sendPayment(quote: Quote, payment: BuiltPayment, timeoutMs = 120_000): Promise<PayResult> {
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(quote.request.url, {
      method: quote.request.method,
      headers: { accept: "application/json", ...(quote.request.body ? { "content-type": "application/json" } : {}), ...quote.request.headers, ...payment.headers },
      body: quote.request.body,
      redirect: "error",
      // Sellers settle before they answer; hanging up early can mean paying without receiving.
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { sent: true, httpStatus: null, settled: false, signature: null, memo: payment.memo, bodyText: "", bodyBytes: 0, sha256: null, contentType: null,
      error: `The seller did not answer${e instanceof Error && e.name === "TimeoutError" ? " in time" : ""} after the payment was sent.`, ms: Date.now() - started };
  }
  const { text, bytes, sha256, truncated } = await readCapped(res).catch(() => ({ text: "", bytes: 0, sha256: "", truncated: true }));
  let settled = false;
  let signature: string | null = null;
  try {
    const http = new x402HTTPClient(new x402Client());
    const s = http.getPaymentSettleResponse((name) => res.headers.get(name)) as { success?: boolean; transaction?: string };
    settled = s.success === true;
    // Only a well-formed signature is kept, and it is still confirmed onchain before it is trusted.
    signature = typeof s.transaction === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(s.transaction) ? s.transaction : null;
  } catch { /* the seller sent no settlement report */ }
  return {
    sent: true, httpStatus: res.status, settled, signature, memo: payment.memo, bodyText: text, bodyBytes: bytes, sha256: sha256 || null, contentType: res.headers.get("content-type"),
    error: res.ok ? (truncated ? "The seller's answer was larger than we accept." : null) : `The seller answered HTTP ${res.status} after the payment was sent.`, ms: Date.now() - started,
  };
}
