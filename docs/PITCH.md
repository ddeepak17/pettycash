# Finals pitch

Four minutes on stage, then two minutes of questions. The script below is about 550 spoken words. The demo is live on the deployed app, not on slides. Interface labels in quotation marks are the exact labels from `docs/VIDEO.md`.

Updated 2026-11-20 04:20 CST: the mainnet items below are proven. The README evidence table, rows 7 to 12, has the transaction links. Never say a number or a transaction that is not in that table.

## Before you go on stage

- Open https://pettycash-pink.vercel.app. The top bar should read "Real USDC on Solana mainnet".
- Check that the card "Try it now, on us" is visible and the house petty cash has budget left. README row 11 says the funded house account is still pending. If it is not funded, the first demo step cannot run live: go straight to the fallback below.
- Have a Solana Explorer tab ready for the failed transaction.
- Keep the recorded run and a public run page (`/r/<id>`, a house errand) open in other tabs.

## The script (4:00)

### Hook (0:00 to 0:15)

Say: "Would you hand an AI agent your wallet? Most people say no, and they are right. But an agent that cannot pay for anything is not much use. So we built a middle way. Give your AI petty cash, not your wallet."

### Problem (0:15 to 0:35)

Say: "Today you have two bad options. Fund a wallet for the agent, and one bug or one hostile web page can empty it. Or hand it API keys, and manage accounts and bills with every provider, while learning what was spent only from the agent's own logs."

### Live demo (0:35 to 2:15, about 100 seconds)

Do each action while saying the line beside it. Lines after "Say:" are spoken; everything else is a stage direction.

1. On the landing page, click the suggestion "What is the weather in Austin today and tomorrow, and do I need a jacket?" under "Try it now, on us".
   Say: "This is live on Solana mainnet, with real USDC. No wallet, no sign-up. It runs on a public budget our team funded, and that budget is itself capped on Solana, so it is safe to leave open."
2. Point at the lines "Thinking, paid to BlockRun", the "Quote" block, "Rule check: allowed", "Pulled", "Paid", "Came back".
   Say: "The agent asked a company for a price. Our code checked the price against a short list of approved sellers. Then it paid. It pays real companies, both for its own thinking and for the data it needs, a fraction of a cent each. It holds no API keys. It pays per request."
3. In the "Receipts" column, wait for the "Verified" stamp. Click "Seller paid" and show the explorer page.
   Say: "A receipt starts as unconfirmed. It is stamped verified only when a QuickNode Stream, watching the chain on its own, shows the exact amount reaching the exact seller. Not the agent's word."
   Only say "verified" while the stamp is on screen. If it has not appeared, say "it is still waiting for independent confirmation" and move on.
4. Click "Test the limit". Show "Solana refused it. The limit holds." and "program error 300 · amountExceedsLimit". Click "Open the failed transaction on Solana Explorer".
   Say: "What if the agent, or even our own server, tried to take more? Let us try. We ask Solana to pull one millionth of a dollar more than what is left. Refused. This is a real failed transaction. The limit is Solana's program, not our code."
   (Proven on mainnet: the failed transaction is row 9 of the README evidence table. The landing page link "Try to overspend the house petty cash" shows it live with no wallet.)
5. If time and a wallet are ready: click "Revoke", approve in the wallet.
   Say: "When I change my mind, I revoke. One click, from my own wallet. It works even without our site."
   (Proven on mainnet: row 10 of the README evidence table.)

### Why Solana and why QuickNode Streams (2:15 to 2:55)

Say: "Why Solana? A purchase costs a fraction of a cent, so the network fee has to be smaller still, and Solana already has a program that gives a wallet a capped, expiring, revocable spender without moving the money into anyone's custody."

Say: "Why QuickNode Streams? The Stream is how we check the agent, because it sends us every transaction that names the agent's key straight from the chain, so a receipt is stamped verified only when those chain numbers match the price."

Say: "To be precise about trust. The agent holds the price of one purchase for a few seconds. The limit, the expiry and the revoke are enforced by Solana's Subscriptions and Allowances program. The seller list and the per-purchase rules are enforced by our server. If our server were hacked, the worst case is the money left in the budget, never more."

### Honest positioning (2:55 to 3:15)

Say: "The allowance idea is not ours. Solana announced it, a tutorial shows it, and an earlier project, BudgetRail, built it. What we add is that it works against real third-party sellers on mainnet through their normal payment services, receipts are checked by an independent data source, and anyone can try it without a wallet."

### What is next (3:15 to 3:45)

Say: "Next, we want to remove the brief moment where the agent's key holds money. We would propose a payment scheme where the seller is paid straight from your wallet under the allowance. After that, daily budgets in the interface, an open record of which sellers actually deliver, and a professional security audit before anyone uses more than small amounts. Today this is a hackathon build for cents and single dollars, and we say so."
"Every purchase you just saw is a real transaction on Solana mainnet. The first one we ever made, with both of its transactions, is row 7 of our README."

### Close (3:45 to 4:00)

Say: "Petty Cash. The limit lives on Solana. The receipts are checked by QuickNode Streams. The agent pays real companies, and you can revoke it in one click. Try it yourself right now, no wallet needed."

## Six slides behind the script

The demo is live. Slides only frame it. Show a slide while speaking its section.

| # | Title | The one thing on it |
|---|---|---|
| 1 | Give your AI petty cash, not your wallet | The tagline, the app address, the track names |
| 2 | Two bad options today | A funded wallet can be emptied. API keys mean accounts and bills everywhere |
| 3 | How one purchase works | Quote, rule check, pull, pay, Stream check, in five boxes (the README diagram, simplified) |
| 4 | Who enforces what | Two columns: "Enforced by Solana" (total, expiry, revoke, only the agent's key) and "Enforced by our server" (sellers, ceiling, exact payment) |
| 5 | What is ours and what is not | The allowance idea is Solana's. We add real sellers, independent receipts, a public demo |
| 6 | Worst case, and what is next | If our server is hacked, the loss is capped by what is left in the budget. Next: seller paid straight from the allowance |

The live demo sits between slides 2 and 3.

## If the live demo fails

1. Say it plainly: "The live run did not work, so here is the recorded one." Do not explain network trouble at length.
2. Play the recorded run (the 2:30 video made from `docs/VIDEO.md`). Narrate the same lines.
3. Open a public run page, `/r/<id>`, from a house errand that already finished. It shows the whole errand and its receipts, and every receipt links two ordinary explorer transactions.
4. If a receipt never reaches "Verified" live, say that this is the designed behaviour when the Stream is late: purchases still work and receipts wait for independent confirmation. Do not show it as verified.
5. If the failed-transaction link does not load, open the program address on Solana Explorer, `De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44`, and say that the limit is enforced there.

## 30-second version

Would you hand an AI your wallet? We built petty cash instead. You set aside a few dollars in your own wallet. The agent pays real companies in real USDC for what it needs. Solana's program enforces the limit, and you can revoke it any time. A QuickNode Stream checks every receipt against the chain, not against the agent's word. Try it now, no wallet needed.

## One-sentence version

Petty Cash lets you give an AI agent a small, Solana-enforced budget to pay real sellers in USDC, with every receipt checked by a QuickNode Stream.

## Say this, not that

| Say | Do not say | Why |
|---|---|---|
| "The agent holds the price of one purchase for a few seconds." | "The agent never holds your money." | It does hold it between the pull and the payment. |
| "Solana's Subscriptions and Allowances program enforces the limit." | "Our contract" or "our smart contract" | We deploy no program of our own. |
| "Solana's program is audited. Our code is not." | "Petty Cash is audited." | Our code has had tests and one AI-assisted review, not a professional audit. |
| "Our server enforces the seller list and the per-purchase rules." | "Everything is enforced onchain." | Only the total, expiry, revoke and who can pull are onchain. |
| "If our server is hacked, an attacker can take what is left in the budget." | "Even a hack cannot lose money." | The loss is capped, not zero. |
| "Verified by a QuickNode Stream" only while the stamp is on screen. | "Every receipt is verified." | Receipts wait if the Stream is late. |
| "If a payment does not complete, the money is returned." | "Refunds always happen." | A seller that takes the payment and returns nothing keeps it. |
| "Real USDC on Solana mainnet." | "Test money" or "devnet" | The demo is mainnet. |
| "The allowance idea is Solana's. We add real sellers, independent receipts and a public demo." | "We invented agent allowances." | Solana, a tutorial and BudgetRail came first. |
| "Delivered means the seller answered." | "Delivered means the result was good." | We record size and hash, not quality. |
| "It works with ten endpoints from nine sellers." | A seller or price not on screen in that run | Which tools the agent buys is its own choice. |
