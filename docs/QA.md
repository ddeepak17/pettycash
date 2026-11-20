# Judge questions and answers

Two minutes of questions follow the four-minute pitch. Keep each answer to two to four sentences. Every answer below is taken from `README.md`, `docs/TRUST.md`, `docs/EVIDENCE.md` or `docs/ARCHITECTURE.md`. Where we have not done something, the answer says so.

Slots in square brackets starting with `PENDING` are not proven. Do not say them unless the README evidence table has been updated. At the time of writing, a real paid purchase on mainnet, the over-limit refusal on mainnet, a mainnet revoke, the first Stream delivery of a purchase by our own agent, and the funded public demo account are all pending.

## Solana representative

**1. Why this program, and not Squads, Swig or a plain SPL token delegation?**
We did not build a comparison of those options, so we will not rank them. We chose Solana's Subscriptions and Allowances program because it is Solana's own, it has been audited multiple times by Cantina according to its repository, and it gives exactly what we needed: a capped, expiring allowance for one spender, revocable by the owner at any time, with the money staying in the owner's wallet. We have not tested the other options against our use.

**2. What does the program not enforce?**
It does not restrict where pulled funds go. A fixed allowance has no recipient restriction, so once the agent's key has pulled the money, the program cannot say who receives it. That is why our server keeps a seller list, pinned recipients and a pre-send check on the payment. Those rules are ours, not the chain's, and they are lost if our server is compromised.

**3. Why pull just in time into the agent's account, instead of paying the seller straight from the allowance?**
Because real x402 sellers expect an ordinary USDC transfer signed by the payer and submitted by their own facilitator. Pulling first and then paying with a standard transfer means no seller has to change anything. The cost is the brief custody: the agent's key holds the price of one purchase for a few seconds, or a few minutes if a payment's outcome is unclear.

**4. What does a purchase cost in fees?**
Each purchase needs one extra Solana transaction, the pull, paid by the agent's key. We measured about $0.0004 at 2026-11-20 prices, which is a large share of a $0.001 purchase. The seller's own facilitator pays the fee of the payment itself.

**5. What would you propose upstream?**
An x402 payment scheme in which the seller is paid straight from the owner's wallet under the allowance. Then the agent's key would never hold funds and the recipient would be fixed inside the same transaction as the pull. This is a proposal we would like to make, not something we have built or submitted.

## QuickNode

**6. How is the Stream configured, and why that dataset?**
It runs on `solana-mainnet` with the `block` dataset and a filter in `infra/quicknode/filter.js`. The filter keeps a transaction only if it names the agent's key and sends a compact object with the signature, the programs, the memos and the net token change per wallet. We tested `programs_with_logs` and rejected it, because it lists only balances after the transaction, so a change cannot be computed from it. The destination is a webhook on our app, signed with HMAC-SHA256.

**7. What happens if the Stream is down or late?**
Purchases still work. Receipts stay at "Paid. Waiting for independent confirmation" and nothing else can mark them verified. So verification is late or missing, never wrong. One related limit: the Stream is set up without reorganisation correction, so in principle a stamp could come from a block the chain later drops. The explorer links on every receipt show the final state.

**8. What does it cost, and why not just read RPC?**
QuickNode bills per processed block, so the Stream is created paused, started when an errand begins and paused again after about two idle minutes. We have not published a dollar figure for it. We could read RPC ourselves, and we do for the purchase's own settlement check, but then the stamp would depend on our own reads. The point of the Stream is a second, independent source: we also compared its filter output with `getTransaction` from a different provider on real blocks.

## Organizers and general

**9. Who is the user?**
Someone who wants an AI agent to pay for small things without giving it a wallet or a pile of API keys. Today that means a developer or a curious user who is comfortable with a Solana wallet and USDC. We have not run a study with real users, and the interface and defaults are built for cents and single dollars.

**10. Why would anyone trust it?**
They do not have to trust the agent or the seller, and they trust Solana for the total, the expiry and the revoke. They do trust our server for the finer rules. Every receipt links two ordinary explorer transactions, and the code, the threat model and the evidence table are public. Our own code has no professional audit, and we say so.

**11. What stops prompt injection?**
The model never holds a key and never builds a transaction. It can only answer or name a tool from a fixed catalog, and tool results go back to it as quoted data. The rule check and the onchain limit are code and chain state that no text can change. A fooled model can still waste the errand's small budget on catalog tools. The app ships a page at `/trap` that tries this, and a local test with a hostile search result passed.

**12. What is the business model?**
We do not have a proven one, and we will not invent one here. Honest facts: each purchase costs the operator about $0.0004 in network fees, which is large next to a $0.001 purchase, so any model has to cover that. The open delivery record per seller is a direction we want to explore, not a revenue plan.

**13. How is this different from BudgetRail, and from Coinbase or Circle agent wallets?**
BudgetRail, from August 2026, built capped agent allowances for x402 on the same program, paying its own test merchant through a facilitator it runs. We pay real third-party sellers on mainnet through their stock facilitators, verify receipts from a Stream, and offer a public demo. We have not studied Coinbase or Circle agent wallets closely enough to compare, so we will not make claims about them.

**14. What was the hardest part?**
Settling unclear payments safely: what to do when a seller goes quiet after a payment was sent. Money may only come back when the chain shows the payment can never land, and it must come back exactly once. Getting that right took a rewrite of the reconciliation, and it is why a refund can take about two to three minutes.

**15. What broke during testing, and how did you find it?**
An AI-assisted adversarial review found that the same refund could be sent twice, that a seller's own settlement claim was trusted, that money was pulled before the payment was known to be buildable, and that a payment could be pushed out of the range we searched. All were fixed. The local rehearsal then caught two mistakes in the fixes: a brand-new blockhash looks invalid exactly like an expired one, and two identical transactions share one signature, so two refunds collapsed into one.

**16. How much works today, and how much is pending?**
Done and reproducible: our instruction builders pass 11 of 11 checks against the mainnet program build on a local chain, the purchase engine passes 25 of 25 in a local rehearsal (with a test-double seller and model), 148 automated tests pass, all ten catalog sellers answered with a mainnet price, and the live Stream delivered real mainnet payments to our webhook. Pending: [PENDING: real purchase signatures], [PENDING: mainnet over-limit refusal signature], [PENDING: mainnet revoke signature], [PENDING: Stream delivery verifying our own purchase], [PENDING: funded public demo account]. Say clearly which of those is filled in on the day.

**17. What would you do with another month?**
Build the proposal for paying the seller straight from the allowance, put recurring daily budgets in the interface (the program and our server already support them), build an open per-seller delivery record from Stream-verified receipts only, and get a professional audit of the server-side rule check and payment check.

## Hard ones

**18. What happens if your server is hacked?**
The attacker could take what is left in every live petty cash set aside for this agent, and send it anywhere, until the owners revoke or the allowances expire. The server's seller list and rules would be gone. Nothing else in a wallet is reachable, and the loss is capped by the allowance. The database holds no keys, but the agent's key is a server setting, so its theft is the case we are describing.

**19. A seller takes the money and returns garbage. Is it just a prepaid balance with extra steps?**
On the seller: x402 has no refund from a seller, so we record it as paid and not delivered. The loss is at most one purchase, capped by the ceiling of $0.05. We record the size and hash of what came back and do not judge its quality. On the prepaid balance: a prepaid balance sits with a third party. Here the money stays in your wallet until a pull, the limit and expiry are enforced by Solana, and you can revoke without us. The difference is real but bounded, because the agent's key still holds one purchase's price briefly.

**20. AI tools were used to build this. What did you do?**
Template for the team to fill in, in your own words and only with true statements:
"We used AI tools to [PENDING: what the team used them for]. My own part was [PENDING: the presenter's role]. My teammate's part was [PENDING: the teammate's role]. What I can explain and defend from the code is [PENDING: the parts you have walked through]. The AI-assisted adversarial review of the money paths is in our trust document, and it is not a professional audit."
Do not claim who wrote what unless it is true. If you do not know a detail, say so and point to the file: the repository documents every layer.
