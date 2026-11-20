// The contract between the server and the browser. Amounts are strings of token base units
// (USDC has 6 decimals: "1000" is $0.001). Signatures and addresses are base58 strings.

export type Cluster = "mainnet-beta" | "devnet";

/** GET /api/config */
export type PublicConfig = {
  cluster: Cluster;
  /** CAIP-2 network id used by x402, for example solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp */
  network: string;
  rpcUrl: string;
  usdcMint: string;
  /** The agent's public key. This is the only key allowed to spend from a petty cash (the delegatee). */
  agent: string;
  allowancesProgram: string;
  limits: {
    /** Purchases above this are refused outright by the server. */
    perPurchaseMaxBase: string;
    /** Purchases above this pause the run and ask the person first. */
    approvalThresholdBase: string;
    maxSteps: number;
  };
  /** The public demo petty cash that anyone can try without a wallet. Null when it is switched off. */
  house: null | { owner: string; delegation: string; remainingBase: string; perRunBudgetBase: string; expiryTs: number };
  /** True while the QuickNode Stream is delivering. */
  streamActive: boolean;
  catalog: CatalogEntry[];
};

/** A paid service the agent is allowed to buy from. */
export type CatalogEntry = {
  id: string;
  name: string;
  host: string;
  kind: "search" | "read" | "data" | "news" | "image" | "reasoning";
  description: string;
  /** Price we last saw, in base units. The real price is whatever the seller quotes at purchase time. */
  lastPriceBase: string;
  /** Our own record of this seller, built only from receipts verified by the Stream. */
  record: { purchases: number; delivered: number };
};

/** GET /api/allowance?owner=<address> */
export type AllowanceState = {
  owner: string;
  usdcBalanceBase: string;
  solLamports: string;
  /** False until the wallet has run the one-time setup instruction of the Allowances program. */
  authorityInitialized: boolean;
  authorityInitId: string | null;
  allowances: Allowance[];
};

export type Allowance = {
  address: string;
  nonce: string;
  type: "fixed" | "recurring";
  /** What the agent can still pull right now. */
  remainingBase: string;
  /** Recurring only. */
  amountPerPeriodBase?: string;
  periodSecs?: number;
  /** Unix seconds; 0 means no expiry. */
  expiryTs: number;
  expired: boolean;
  /** Who paid the account's rent. Needed to revoke. */
  rentPayer: string;
};

/** POST /api/auth/challenge { owner } */
export type AuthChallenge = { message: string; expiresAt: number };
/** POST /api/auth/verify { owner, message, signature (base64) } -> { owner }.  GET /api/auth/me -> { owner | null } */
export type AuthSession = { owner: string | null };

/** POST /api/run and POST /api/house/run. The response is newline-delimited JSON: one RunEvent per line. */
export type RunRequest = {
  task: string;
  /** Address of the petty cash (allowance account) to spend from. Ignored by /api/house/run. */
  delegation?: string;
  /** Optional tighter limits chosen by the person for this run. */
  runBudgetBase?: string;
  approvalThresholdBase?: string;
};

export type SellerRef = { id: string | null; name: string; host: string; url: string };
export type PolicyCheck = { rule: string; pass: boolean; detail: string };

export type RunEvent =
  | { type: "run_started"; runId: string; owner: string; delegation: string; task: string; runBudgetBase: string; remainingBase: string; at: number }
  /** One short sentence from the agent about what it will do next and why. */
  | { type: "thinking"; step: number; text: string }
  /** A seller answered with a price. Nothing has been paid yet. */
  | { type: "quote"; purchaseId: string; step: number; kind: "reasoning" | "tool"; seller: SellerRef; amountBase: string; payTo: string; description: string }
  /** The server's rule check for that price. "ask" means a person must approve. */
  | { type: "policy"; purchaseId: string; decision: "allow" | "ask" | "deny"; checks: PolicyCheck[] }
  | { type: "approval_needed"; purchaseId: string; amountBase: string; seller: SellerRef; reason: string; expiresAt: number }
  | { type: "approval_result"; purchaseId: string; decision: "approved" | "denied" | "timed_out" }
  /** The exact amount moved from the owner's wallet to the agent under the allowance. */
  | { type: "pulled"; purchaseId: string; signature: string; amountBase: string; remainingBase: string; ms: number }
  /** The Allowances program refused the pull. This is the onchain limit doing its job. */
  | { type: "chain_refused"; purchaseId: string; code: number | null; name: string; plain: string }
  /** The seller accepted payment. signature can be null when the seller did not report it. */
  | { type: "paid"; purchaseId: string; signature: string | null; httpStatus: number; ms: number }
  | { type: "delivered"; purchaseId: string; bytes: number; sha256: string; preview: string }
  | { type: "purchase_failed"; purchaseId: string; stage: "quote" | "policy" | "pull" | "payment" | "delivery"; error: string; refund: null | { status: "refunded"; signature: string } | { status: "pending" } }
  | { type: "answer"; text: string }
  | { type: "run_finished"; runId: string; status: "done" | "failed" | "stopped"; spentBase: string; purchases: number; ms: number }
  | { type: "error"; message: string };

/** POST /api/run/:id/approve */
export type ApprovalRequest = { purchaseId: string; decision: "approved" | "denied" };

/** What QuickNode Streams told us about a transaction. Present only when the Stream delivered it. */
export type StreamProof = {
  signature: string;
  slot: number;
  blockTime: number | null;
  ok: boolean;
  /** Milliseconds between the block's time and our receipt of the delivery. */
  receivedAt: number;
  /** Token movements decoded by the stream filter, per owner wallet, in base units (negative = paid out). */
  movements: { owner: string; mint: string; deltaBase: string }[];
  /** Memo texts in the transaction, as the stream filter read them. */
  memos?: string[];
};

/** A receipt. `verified` is true only when the Stream's own data matches the seller's quote. */
export type Receipt = {
  id: string;
  runId: string | null;
  owner: string;
  kind: "reasoning" | "tool";
  seller: SellerRef;
  payTo: string;
  amountBase: string;
  status: "denied" | "awaiting_approval" | "pulled" | "paid" | "delivered" | "failed" | "refunded";
  pullSignature: string | null;
  paySignature: string | null;
  refundSignature: string | null;
  httpStatus: number | null;
  responseSha256: string | null;
  responseBytes: number | null;
  createdAt: number;
  pullProof: StreamProof | null;
  payProof: StreamProof | null;
  verified: boolean;
  /** Plain reason when the Stream's data disagrees with the quote (wrong amount, recipient or token). */
  mismatch: string | null;
};

/** GET /api/receipts?owner=<address>&limit=50  and  GET /api/runs/:id */
export type ReceiptsResponse = { receipts: Receipt[] };
export type RunSummary = { id: string; owner: string; task: string; status: string; answer: string | null; spentBase: string; isHouse: boolean; createdAt: number; finishedAt: number | null };
export type RunDetail = { run: RunSummary; events: RunEvent[]; receipts: Receipt[] };

/** POST /api/prove/overspend { delegation }  -> the Allowances program's own refusal of a pull above the limit. */
export type ProofResult = {
  attemptedBase: string;
  remainingBase: string;
  refused: boolean;
  code: number | null;
  name: string;
  plain: string;
  /** Present when the attempt was sent to the chain rather than only simulated. A failed transaction anyone can open. */
  signature: string | null;
  logs: string[];
};
