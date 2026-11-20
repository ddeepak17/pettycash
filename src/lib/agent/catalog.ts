// The sellers the agent may buy from. Every entry was reached on Solana mainnet and answered with a real price
// (see docs/EVIDENCE.md). `payTo` is pinned: if a seller starts asking to be paid somewhere else, the purchase is
// stopped and a person is asked. `maxPriceBase` is the most we accept without asking.
import type { SellerRequest } from "../x402/client";

export type ToolParam = { name: string; description: string; required: boolean; example: string };

export type Seller = {
  id: string;
  name: string;
  host: string;
  kind: "search" | "read" | "data" | "news" | "image" | "reasoning";
  /** Written for the model: when to use the tool. */
  description: string;
  /** Written for people: what the seller sells, in a few words. */
  summary: string;
  params: ToolParam[];
  /** Pinned recipient wallet for this seller on Solana mainnet. */
  payTo: string;
  /** Price last seen, in USDC base units. */
  lastPriceBase: string;
  /** Above this the purchase needs a person's approval. */
  maxPriceBase: string;
  /** How long to wait for the paid response. */
  timeoutMs: number;
  build: (input: Record<string, string>) => SellerRequest;
};

const q = (base: string, params: Record<string, string | undefined>) => {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") u.searchParams.set(k, v);
  return u.toString();
};
const clip = (s: string | undefined, n: number) => (s ?? "").slice(0, n);

export const SELLERS: Seller[] = [
  {
    id: "web_search",
    name: "Minifetch",
    host: "minifetch.com",
    kind: "search",
    summary: "Keyword web search with titles, links and snippets.",
    description: "Keyword web search. Returns ranked results with title, URL and a text snippet. Best first step for anything that needs current information from the web.",
    params: [{ name: "query", description: "What to search for, as a few keywords", required: true, example: "best tacos near UT Austin" }],
    payTo: "46vMcwuC4sK11sB3gkLhyA7J7GEwfkhn5rFyDtihBwqe",
    lastPriceBase: "1000",
    maxPriceBase: "5000",
    timeoutMs: 60_000,
    build: (i) => ({ method: "GET", url: q("https://minifetch.com/api/v1/x402/search/keyword", { query: clip(i.query, 200), limit: "6", descriptionLength: "400" }) }),
  },
  {
    id: "read_page",
    name: "Minifetch",
    host: "minifetch.com",
    kind: "read",
    summary: "Reads one web page and returns its text.",
    description: "Reads one web page and returns its text as clean markdown. Use it on a URL from a search result when the snippet is not enough.",
    params: [{ name: "url", description: "The full https URL of the page to read", required: true, example: "https://solana.com/news" }],
    payTo: "46vMcwuC4sK11sB3gkLhyA7J7GEwfkhn5rFyDtihBwqe",
    lastPriceBase: "1000",
    maxPriceBase: "5000",
    timeoutMs: 60_000,
    build: (i) => ({ method: "POST", url: "https://minifetch.com/api/v1/x402/extract/url-content", body: JSON.stringify({ url: clip(i.url, 500) }) }),
  },
  {
    id: "web_search_premium",
    name: "Exa",
    host: "api.exa.ai",
    kind: "search",
    summary: "Higher quality semantic web search.",
    description: "Higher quality semantic web search by Exa. Costs more than web_search; use it only when web_search results were poor or the question needs precise sources.",
    params: [{ name: "query", description: "A natural-language description of what you are looking for", required: true, example: "official announcement of Solana Subscriptions and Allowances program" }],
    payTo: "12Ec2cJmfR1C9uwejzxcuMhUgEC7wDrLgm1wBvvR5w9E",
    lastPriceBase: "7000",
    maxPriceBase: "15000",
    timeoutMs: 60_000,
    build: (i) => ({ method: "POST", url: "https://api.exa.ai/search", body: JSON.stringify({ query: clip(i.query, 300), numResults: 5, type: "auto" }) }),
  },
  {
    id: "weather",
    name: "Agent Data Tools",
    host: "agent-data-tools.revmesh2074.workers.dev",
    kind: "data",
    summary: "Current weather and a 48-hour forecast for any city.",
    description: "Weather for any city: current conditions and an hourly forecast up to 48 hours ahead (MET Norway data).",
    params: [{ name: "city", description: "City name", required: true, example: "Austin" }],
    payTo: "82wfSCZhCmZA7zwqqt6Q3FG8nqYBwUvbThP6M97fa9Q6",
    lastPriceBase: "2000",
    maxPriceBase: "5000",
    timeoutMs: 45_000,
    build: (i) => ({ method: "GET", url: q("https://agent-data-tools.revmesh2074.workers.dev/weather/forecast", { city: clip(i.city, 80) }) }),
  },
  {
    id: "crypto_news",
    name: "Otto AI",
    host: "x402.ottoai.services",
    kind: "news",
    summary: "Today's crypto headlines with sources.",
    description: "Today's most important crypto headlines with source links and publish times, plus a short market brief. Takes no input.",
    params: [],
    payTo: "6XcSfqJHr9vNW2vbiRaMqUYVm7shDgLepca54wUTDPN5",
    lastPriceBase: "1000",
    maxPriceBase: "5000",
    timeoutMs: 45_000,
    build: () => ({ method: "GET", url: "https://x402.ottoai.services/crypto-news" }),
  },
  {
    id: "coin_price",
    name: "x402engine",
    host: "x402engine.app",
    kind: "data",
    summary: "Live cryptocurrency prices with 24-hour change.",
    description: "Live prices for cryptocurrencies with 24-hour change. Ids are CoinGecko ids such as solana, bitcoin, ethereum, usd-coin.",
    params: [{ name: "ids", description: "Comma-separated coin ids", required: true, example: "solana,bitcoin" }],
    payTo: "Gzehfseq1k9AcHFSoV7qHmDGQx92nLMw78XXdqVWQQWa",
    lastPriceBase: "1000",
    maxPriceBase: "5000",
    timeoutMs: 45_000,
    build: (i) => ({ method: "GET", url: q("https://x402engine.app/api/crypto/price", { ids: clip(i.ids, 120).replace(/\s+/g, ""), currencies: "usd", include_24h_change: "true" }) }),
  },
  {
    id: "company_news",
    name: "2s.io",
    host: "2s.io",
    kind: "news",
    summary: "Recent news about a US-listed company.",
    description: "Recent news about a US-listed company, by stock ticker, from the last 14 days.",
    params: [{ name: "ticker", description: "Stock ticker symbol", required: true, example: "NVDA" }],
    payTo: "TW6ntaGzvj63ZgPjszd4FCGmVTGfzv1MAYZbjYcyWhn",
    lastPriceBase: "2500",
    maxPriceBase: "6000",
    timeoutMs: 45_000,
    build: (i) => ({ method: "GET", url: q("https://2s.io/api/stocks/company-news", { ticker: clip(i.ticker, 8).toUpperCase().replace(/[^A-Z.]/g, "") }) }),
  },
  {
    id: "dex_pools",
    name: "CoinGecko",
    host: "pro-api.coingecko.com",
    kind: "data",
    summary: "Onchain DEX pool prices, liquidity and volume.",
    description: "Search onchain DEX pools and tokens by name, symbol or contract address. Returns pool prices, liquidity and volume.",
    params: [
      { name: "query", description: "Token name, symbol or contract address", required: true, example: "jup" },
      { name: "network", description: "Network id such as solana, eth, base", required: false, example: "solana" },
    ],
    payTo: "8XhngTRitTcUJMiaDJ6azw8GRSiFPpwhnmV3HYQLHUpL",
    lastPriceBase: "5000",
    maxPriceBase: "10000",
    timeoutMs: 45_000,
    build: (i) => ({ method: "GET", url: q("https://pro-api.coingecko.com/api/v3/x402/onchain/search/pools", { query: clip(i.query, 80), network: clip(i.network, 20) || undefined, include: "base_token", page: "1" }) }),
  },
  {
    id: "make_image",
    name: "agent402",
    host: "agent402.tools",
    kind: "image",
    summary: "One generated image. The agent always asks you first.",
    description: "Generates one 1024x1024 image from a text prompt. Expensive compared with the other tools, so a person is always asked first.",
    params: [{ name: "prompt", description: "What the image should show", required: true, example: "A paper receipt folded into an origami bird, studio light" }],
    payTo: "J7aN3PLJnTCF5qpEnvJHJsnCjcGuqC2rYtEM8Gv3xwg",
    lastPriceBase: "30000",
    maxPriceBase: "30000",
    timeoutMs: 110_000,
    build: (i) => ({ method: "POST", url: "https://agent402.tools/api/image-gen", body: JSON.stringify({ prompt: clip(i.prompt, 900) }) }),
  },
];

/** The agent's own reasoning is bought the same way: one paid chat-completion request per step. */
export const REASONING_SELLER = {
  id: "reasoning",
  name: "BlockRun",
  host: "sol.blockrun.ai",
  kind: "reasoning" as const,
  description: "The agent's own reasoning, bought per request.",
  summary: "The agent's own thinking, bought one step at a time from a model provider.",
  url: "https://sol.blockrun.ai/api/v1/chat/completions",
  payTo: "AQqnMFBwGZEoti85aTVRy8XYpKrho7GaMDx9ZB3CEeKA",
  lastPriceBase: "1000",
  maxPriceBase: "20000",
  timeoutMs: 60_000,
};

export const sellerById = (id: string) => SELLERS.find((s) => s.id === id) ?? null;

/** Validates tool input from the model: only declared parameters, strings only, required ones present. */
export function cleanInput(seller: Seller, input: unknown): { ok: true; input: Record<string, string> } | { ok: false; error: string } {
  const out: Record<string, string> = {};
  const src = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  for (const p of seller.params) {
    const v = src[p.name];
    if (v === undefined || v === null || v === "") {
      if (p.required) return { ok: false, error: `Missing "${p.name}" for ${seller.id}.` };
      continue;
    }
    if (typeof v !== "string" && typeof v !== "number") return { ok: false, error: `"${p.name}" must be text.` };
    out[p.name] = String(v);
  }
  if (seller.id === "read_page") {
    try {
      const u = new URL(out.url);
      if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "The page address must start with https://." };
    } catch { return { ok: false, error: "That is not a valid page address." }; }
  }
  return { ok: true, input: out };
}
