# Trust and threat model

This file says who can do what, what stops them, and what is left over. It is written to be checked against the code, so each row names the layer and the file.

## The short version

- **You trust Solana and one program** for the things that matter most: the total limit, the expiry and revocation. These hold even if our server is hostile.
- **You trust our server** for the finer rules: which sellers get paid, how much one purchase may cost, when you are asked. If our server is compromised, those rules are gone and the worst case is the loss of what is left in the petty cash, never more.
- **You do not have to trust the agent or the seller** about what was paid. A receipt is marked verified only from a QuickNode Stream's data, and every receipt links both transactions on a public explorer.

## The four layers

| # | Layer | Code | Enforces |
|---|---|---|---|
| 1 | Solana's Subscriptions and Allowances program | `De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44` | Total limit, expiry, only the agent's key can pull, revocation by the owner at any time without us. It does not restrict where pulled funds go |
| 2 | Rule check on our server | `src/lib/agent/policy.ts` | Approved sellers only, right network and token, per-purchase ceiling, errand budget, petty cash state. Asks the owner for a changed recipient, an unusual price, anything above the ask-first line and any image |
| 3 | Pre-send payment check on our server | `assertPaymentIsExactlyTheQuote` in `src/lib/x402/client.ts` | The signed payment is exactly one `TransferChecked` of the quoted amount, token and recipient from the agent's own token account. Only compute-budget and memo instructions may accompany it. The x402 SDK's own per-payment ceiling is set to the quoted amount as well |
| 4 | The model has no key | `src/lib/agent/loop.ts` | The model never holds a key or builds a transaction. It can only name a tool from the catalog |

## Threats

| Threat | What stops it | Layer | What is left over |
|---|---|---|---|
| The agent tries to spend more than the budget | The program refuses any pull above what is left (error 300). The rule check denies it first | 1, then 2 | Nothing beyond the budget |
| The agent keeps spending after you change your mind | Revoke closes the allowance account from your own wallet, with or without our site. Expiry does the same on its own (error 128) | 1 | A purchase already pulled when you revoke may still complete |
| A web page or tool result tells the model to send money somewhere or to buy more (prompt injection). The app ships a page that tries exactly this, at `/trap` | The model can only answer or name a catalog tool. Results are passed back as data. The rule check and the onchain limit are code and chain state that no text can change | 4, 2, 1 | A fooled model can waste the errand's budget on catalog tools. The loss is bounded by the errand budget |
| The model names a tool that does not exist, or sends crafted input | Unknown tools are refused. Input is reduced to the tool's declared text parameters. Each request is built for that seller's pinned host only. The same purchase is not repeated | 4 | The page reader will fetch any public web address the model names, through its seller, at the usual price |
| A seller raises its price | Above the seller's usual price: the owner is asked. Above the ask-first line ($0.01): the owner is asked. Above the ceiling ($0.05): denied. The SDK cannot sign for more than the quote | 2, 3 | An owner can approve a higher price up to the ceiling |
| A seller, or someone in front of it, quotes a different recipient wallet | The recipient is pinned per seller. A mismatch stops the purchase and asks the owner. On the house petty cash it is refused | 2 | An owner can approve the new recipient. This is an "ask", not a hard no |
| The payment built for a quote contains something else: another transfer, a token approval, a different amount or recipient, another program | The pre-send check decodes the signed transaction and refuses anything but the one quoted transfer. Address lookup tables are refused. The agent is never the fee payer | 3 | The check is our code. It has 13 unit tests and no outside review |
| A seller takes the payment and does not deliver | Nothing can stop this. It is recorded as paid and not delivered, and shows in that seller's delivered count | None | The price of one purchase, at most the ceiling. x402 has no refund from a seller |
| A seller never settles, or the connection drops after the payment was sent | The purchase is held as unresolved. The reconciler looks for the payment onchain by its memo. If it landed it is recorded as paid. If it can no longer land the money is returned | Server | The refund waits at least 150 seconds. A signed payment without a recorded memo is never refunded automatically |
| A refund is paid twice, or paid for a payment that did land | A refund is claimed with one conditional database update, so one caller wins. A signed payment is refunded only after its memo was looked for and not found. If the chain cannot be read, nothing is refunded yet | Server | The lookup covers the last 500 transactions of the agent's token account |
| Our server or the agent's key is compromised | Layer 1 still holds: the cap, the expiry, and your revoke | 1 | The attacker can pull what is left in every live petty cash for this agent and send it anywhere, until you revoke or it expires. Nothing else in your wallet is reachable |
| Someone starts errands on your petty cash | An errand needs a session from a wallet signature on a server-issued challenge. The server checks onchain that the allowance belongs to the session wallet. Only that wallet can approve | Server | A stolen session cookie could run errands inside your limits for up to 12 hours. It could not withdraw anything |
| The public house petty cash is drained | Its total is capped by its onchain allowance. Each errand has a small budget ($0.03). 4 errands per hour per IP address and 40 per hour in total. Nothing that needs approval is bought | 1, then server | The public can use the house budget up. That is what it is for |
| A forged or replayed Stream delivery marks a receipt verified | The webhook requires an HMAC-SHA256 signature made with the Stream's security token, a timestamp within 5 minutes and a nonce that has not been seen. Unauthenticated requests never reach the database | Server | We trust QuickNode to report blocks truthfully and to keep its side of the token secret |
| The agent or the seller claims a payment that did not happen as quoted | `verified` comes only from the Stream's token movements. A disagreement is shown on the receipt as a mismatch with the reason | Stream | The stamp is computed by our server. The two explorer links on every receipt do not depend on us |
| The Stream is paused, late or down | Receipts stay at "waiting for independent confirmation". No other route can mark them verified. Purchases still work | Stream | Verification is late or missing, never wrong |
| A block the Stream delivered is later dropped by the chain | Nothing in our pipeline. The Stream is configured without reorganisation correction | None | A stamp could in principle come from a dropped block. The explorer links show the final state |
| Someone abuses the limit test to burn the agent's fee money | The sent test is limited to 6 per hour per IP address and 60 per hour in total. The simulated test costs nothing | Server | Small network fees |
| Someone with write access to the database | The database holds no keys. The application's role can reach only its own schema | Server | They could insert an approval or a false Stream delivery. Layers 1 and 3, and the deny rules of layer 2, still apply |
| A seller returns a hostile file instead of an image | A delivered image is stored only if its file signature is PNG, JPEG or WebP. It is served with `nosniff` and a content security policy that allows nothing | Server | None known |

## What we rely on that we did not build

- **Solana and the Subscriptions and Allowances program.** We did not write the program and cannot change it. Its repository, [github.com/solana-foundation/subscriptions](https://github.com/solana-foundation/subscriptions), states that it has been audited multiple times by Cantina. Those audits cover specific commits. We did not audit it ourselves. What we did check is that our instructions behave as expected against the mainnet binary (see [EVIDENCE.md](EVIDENCE.md), item 1).
- **The x402 SDK** builds the payment transaction. We do not trust its output blindly: layer 3 checks the signed transaction before it is sent.
- **The sellers' facilitators** pay the network fee and submit the payment. They can only submit what the agent signed.
- **QuickNode** reports blocks and runs our filter. The filter is in the repository (`infra/quicknode/filter.js`) and was compared with a second RPC provider on real blocks.
- **The wallet** you use signs the setup, create and revoke transactions. The interface shows what each one does before you sign.

## What has and has not been reviewed

Petty Cash's own code has automated tests (see [EVIDENCE.md](EVIDENCE.md), items 1 to 3) and AI-assisted review. It has not had a professional security audit. Treat it as a hackathon build and use small amounts.

## If something goes wrong

- **Stop the agent now**: press Revoke, or send the program's revoke instruction for your allowance account from any client. The account closes and no further pull can succeed.
- **Check a receipt yourself**: open "Money moved from wallet" and "Seller paid" on the receipt. Both are ordinary Solana transactions.
- **Check the limit yourself**: press "Test the limit" and open the failed transaction it links.
