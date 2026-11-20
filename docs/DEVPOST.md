# Devpost submission text

Text to paste into the submission form. Each answer is between 80 and 150 words.

## Tagline

Give your AI petty cash, not your wallet.

## Short description

Set aside a few dollars for an AI agent. It pays real x402 sellers in USDC on Solana mainnet, Solana enforces the budget, and a QuickNode Stream checks every receipt.

## Tracks

- Main track: Agentic Payments and AI
- Chain award: Best use of Solana
- Bounty: Best Use of QuickNode Streams

## Links

<!-- EVIDENCE:deployed-url -->

Live app: https://pettycash-pink.vercel.app. The repository link and the video link are added on the form.

## What did you build?

Petty Cash is a web app that lets a person set aside a small budget for an AI agent without handing over a wallet. You pick an amount and an expiry. The money stays in your wallet as a capped allowance in Solana's Subscriptions and Allowances program. You then give the agent an errand in plain words. It buys what it needs from real third-party companies over the x402 payment protocol, in real USDC on Solana mainnet: web search, page reading, market data, weather, news, and even its own reasoning, one paid request at a time. Every purchase shows the seller's quote, the rule check and both transactions. A QuickNode Stream then confirms each receipt independently. Anyone can try it without a wallet on a public house petty cash.

## What problem does it solve?

Agents are starting to pay for things, and the usual options are bad. Give the agent a funded wallet, and one bug, one hostile web page or one leaked key can empty it. Give it API keys, and you manage an account and a bill with every provider. Either way, you learn what was spent from the agent's own logs. Petty Cash separates these concerns. The spending limit lives on Solana, where our server cannot raise it and you can revoke it at any time. Payment is per request, so the agent needs no accounts and no API keys. Proof of what was paid comes from an independent stream of chain data, not from the agent.

## How does it work?

For each purchase the server first asks the seller for a price without paying. A deterministic rule check compares the quote with an approved seller list, the pinned recipient wallet, a per-purchase ceiling and the errand budget, and asks the owner above one cent. The payment is then built, signed and checked before any money moves: code confirms it is exactly one USDC transfer of the quoted amount to the quoted recipient. Only then does the agent's key pull exactly that price from the owner's wallet under the allowance. The program refuses anything above what is left. The seller's facilitator settles the payment. A seller's own word is not proof: the purchase stays open until our read of the chain finds that exact payment, and if it can never land the money is returned, exactly once. A QuickNode Stream on Solana mainnet delivers every transaction involving the agent's key to a webhook, and a receipt is marked verified only when the Stream's token movements match the quote.

## What makes it unique?

The idea of an onchain allowance for an agent is not ours. Solana pitched it when the program launched, a public tutorial shows it, and an earlier project, BudgetRail, built capped agent allowances on the same program with its own merchant and facilitator. What we add, as far as we could find, is four things. It works against real third-party x402 sellers on mainnet through their stock facilitators, because we pull just in time and pay with a standard transfer. Receipts are verified from an independent data source instead of the agent's word. The agent holds no API keys and pays for its own reasoning per request. And there is a public demo anyone can run, safe to leave open because its cost is capped onchain.

## What would you build next?

First, remove the one piece of custody we still have. Today the agent's key holds the price of one purchase for a few seconds. We would propose an x402 payment scheme in which the seller is paid straight from the owner's wallet under the allowance, so the recipient is fixed in the same transaction as the pull. Second, recurring daily budgets in the interface. The program already supports a cap per period, and our server already pulls from such allowances. Third, an open delivery record per seller, built only from Stream-verified receipts, so any agent can see which sellers actually deliver. Finally, a professional security audit of our server-side checks before anyone uses larger amounts.

## Technologies

- Solana mainnet
- Solana Subscriptions and Allowances program (`De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44`)
- USDC on SPL Token
- x402 payment protocol (`@x402/core`, `@x402/svm`)
- QuickNode Streams (dataset `block`, JavaScript filter, webhook destination)
- TypeScript
- Next.js and React
- `@solana/web3.js`, `@solana/kit`, `@solana/spl-token`
- Solana Wallet Adapter (Phantom, Solflare, Backpack)
- PostgreSQL
- Tailwind CSS
- Vitest

## Requirements checklist

| Requirement | Where it is met |
|---|---|
| Agents execute onchain transactions or read the blockchain | README, "How one purchase works" and "How Solana is used" |
| The agent's decision loop is documented | README, "The agent's decision loop" |
| Safety limits are documented | README, "Safety limits" and "What is enforced where"; `docs/TRUST.md` |
| Program ids, and how the project uses Solana | README, "How Solana is used" |
| Stream configuration: network, dataset, filter logic, destination, and why | README, "The QuickNode Stream" |
| Streams as a core data source | README, "The QuickNode Stream" |
| Setup instructions | README, "Run it yourself" |
| Technical documentation and architecture overview | `docs/ARCHITECTURE.md` |

## About the project (Devpost's main description box)

Paste this into the large description field if the form has one in addition to the five questions.

```markdown
## Give your AI petty cash, not your wallet

**Try it now, no wallet needed:** https://pettycash-pink.vercel.app (Solana mainnet, real USDC)

Petty Cash lets you set aside a small budget in your own Solana wallet for an AI agent. The agent runs an errand by paying real companies a fraction of a cent at a time: web search, page reading, market data, weather, even its own reasoning. It holds no API keys. Solana, not our server, refuses any spend above the budget, and every receipt is checked against a QuickNode Stream before it is stamped verified.

### What you can check yourself
- **A real errand.** Open https://pettycash-pink.vercel.app/r/0a3e0a33-0665-4679-9603-00dca143b14d: it cost $0.0043 and each step links to its transaction on Solana Explorer.
- **The limit.** On the landing page, click "Try to overspend the house petty cash". Solana's Subscriptions and Allowances program refuses, and you get a link to the failed transaction.
- **The trap.** Click "Read the trap page and tell me what it says". The page tells AI agents to ignore their limits and send the money away. The agent summarises the page, tells you the page tried to hijack it, and buys nothing else.

### How it works
1. You set aside an amount and an expiry. The money stays in your wallet; Solana records an allowance for one agent key.
2. For each purchase the server asks the seller for a price (HTTP 402), runs a rule check in plain code, builds and checks the payment, pulls exactly that price under the allowance, and pays the seller over x402.
3. A QuickNode Stream on Solana mainnet delivers every transaction that names the agent's key to our webhook. A receipt is verified only when the Stream's token movements match the quote exactly.
4. If a payment does not complete, the money returns to your wallet, exactly once.

### What is real
On 2026-11-20 the agent made its first purchases on Solana mainnet. All ten sellers in its catalog have been paid and have delivered, including Exa, CoinGecko and Minifetch. Receipts are verified by the Stream about a second after their block. An over-limit pull was refused onchain (error 300). A seller that failed after payment was sent triggered an automatic refund. The README has every transaction link.

### What is not ours, and what is
An onchain allowance for an agent is Solana's idea, and others have shown it on devnet with their own test merchant. What we add, as far as we could find: it works against real third-party sellers on mainnet through their stock facilitators, receipts are verified from an independent data source, the agent needs no API keys, and there is a public demo anyone can run.

### Limits we are honest about
The agent's key holds the price of one purchase for a few seconds. The seller list and per-purchase rules are enforced by our server, not the chain. A seller that takes payment and fails keeps it. Our code has tests, a rehearsal with a deliberately misbehaving seller and AI-assisted reviews, not a professional audit. Amounts are cents.

### What is next
An x402 payment scheme that pays the seller straight from the allowance, so the agent never holds anything; recurring daily budgets in the interface; an open delivery record per seller built only from verified receipts.
```

**Built with (tags):** solana, usdc, x402, quicknode, quicknode-streams, typescript, next.js, react, postgresql, tailwindcss, vercel
