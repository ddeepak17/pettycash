# Demo video script

Length: 2 minutes 30 seconds. One continuous screen recording of the deployed app on Solana mainnet, with real USDC. Narration is recorded over it.

Every shot is something the product does. Words in quotation marks under "On screen" are the exact labels in the interface, so the recording can be checked against the script.

## Before recording

- The app is deployed and the top bar shows "Real USDC on Solana mainnet". The Stream label reads "Stream resting until the next errand" until an errand starts, then "Stream live".
- The house petty cash has budget left. The card "Try it now, on us" is visible.
- A browser wallet (Phantom, Solflare or Backpack) holds a few dollars of USDC and a little SOL for network fees.
- That wallet has already done the one-time setup, so setting aside takes one wallet approval. To do the setup, set aside any small amount once and revoke it.
- The wallet is disconnected and the page is at the top.
- The banner "Preview data. Nothing on this page is a real payment." must not be on screen. It appears only in preview mode, which is not the product.

## Shot list

| # | Time | On screen | Exact actions | Narration |
|---|---|---|---|---|
| 1 | 0:00 to 0:10 | The landing page. Headline "Give your AI petty cash, not your wallet." | None. Hold on the headline and the top bar. | "Would you hand an AI agent your wallet? You don't have to. Give it petty cash instead." |
| 2 | 0:10 to 0:35 | The card "Try it now, on us", then the errand as it runs. | Click the suggestion "What is the weather in Austin this weekend, and do I need a jacket?" The errand starts by itself. Watch the lines "Thinking, paid to BlockRun", then a "Quote" block with a seller and a price, "Rule check: allowed", "Pulled", "Paid", "Came back", and finally "Answer". | "This is live on Solana mainnet, with real USDC. No wallet, no sign-up. The agent just paid one company for its own thinking and another for the data it needed, a fraction of a cent each. It has no API keys. It pays per request." |
| 3 | 0:35 to 0:50 | The "Receipts" column beside the errand. | Wait for a receipt to change from "Paid. Waiting for independent confirmation." to the "Verified" stamp. Click "Seller paid" on that receipt. Solana Explorer opens the payment transaction. Return to the app. | "Each receipt starts unconfirmed. It is stamped verified only when a QuickNode Stream, watching the chain on its own, shows the exact amount reaching the exact seller. Not the agent's word. The chain's." |
| 4 | 0:50 to 1:10 | The wallet list, then the panel "Your petty cash". | Click "Connect wallet". Choose the wallet and approve the connection. The panel says "Nothing set aside yet". Click "Set aside petty cash". In "New petty cash" click "$1.00" and leave "24 hours". Click "Continue to wallet". Sign the sign-in message, then approve the transaction. The panel shows "$1.00" and "left". | "Now my own wallet. I set aside one dollar for twenty-four hours. The dollar never leaves my wallet. Solana just records a limit for this one agent." |
| 5 | 1:10 to 1:35 | The errand box and the errand as it runs. | Type "Make an image of a paper receipt folded into an origami bird." Click "Run on my petty cash". A "Quote" block appears for agent402 at $0.03 with "Rule check: needs your yes" and the box "Your yes is needed". Click "Approve $0.03". The lines "Pulled", "Paid" and "Came back" follow. | "This errand needs something bigger: a three cent image. That is over my ask-first line, so the agent stops and asks me. I approve. Three cents are pulled, the seller is paid, and the result comes back." |
| 6 | 1:35 to 1:58 | The window "Testing the limit", then Solana Explorer. | Click "Test the limit". The window shows "Asking Solana to pull more than what is left…", then "Solana refused it. The limit holds." and "program error 300 · amountExceedsLimit". Click "Open the failed transaction on Solana Explorer". Hold on the failed transaction. Return to the app and close the window. | "What if the agent, or our own server, tried to take more? Let's try. We ask Solana for one millionth of a dollar more than what is left. Refused. This is a real failed transaction on mainnet. The limit is not our code. It is Solana's program." |
| 7 | 1:58 to 2:20 | The errand box, the panel "Your petty cash", then the errand. | Click the suggestion "What is new with Solana today? Three bullets with sources." When the first "Thinking, paid to BlockRun" line appears, click "Revoke" and approve it in the wallet. The panel returns to "Nothing set aside yet". In the errand, the next purchase is refused with "This petty cash no longer exists onchain. It was revoked or has been closed." and the errand ends with "I had to stop early." | "And when I change my mind, I revoke. One click, signed by my own wallet. It would work even without this site. The agent's next purchase fails. It is cut off." |
| 8 | 2:20 to 2:30 | The landing page section "What stops it from overspending". | Click "Disconnect" and reload the page. Scroll to "What stops it from overspending" and hold on the two boxes "Enforced by Solana" and "Enforced by our server". | "Petty Cash. The limit lives on Solana. The receipts are checked by QuickNode Streams. The agent pays real companies. Try it yourself, no wallet needed." |

## Notes for each shot

- **Shot 2.** Which tools the agent buys is its own choice, so the sellers and prices on screen may differ from one take to the next. Do not name a seller or a price in the narration unless it is on screen in that take. The line "Budget for this errand" shows the house limit for one errand.
- **Shot 3.** The stamp appears when the Stream's delivery arrives, usually within seconds of the payment. If receipts stay at "Paid. Waiting for independent confirmation." for more than a minute, stop and fix the Stream before recording. Do not record a take in which no receipt is stamped.
- **Shot 4.** The first time a wallet sets aside petty cash, it signs two transactions: the one-time setup and the set-aside. Doing the setup before recording keeps this shot to one approval. The sign-in message is free and is not a transaction. It may also be asked for in shot 5 instead, if the wallet was not signed in.
- **Shot 5.** Image generation always asks first. The reason shown in the box is "$0.03 is over the $0.01 ask-first line." If the agent does not choose the image tool, repeat the take. When the seller returns the image inline, it is shown under "Came back". If it is not shown, keep the take and do not claim in the narration that an image is visible.
- **Shot 6.** The amount in "We asked the chain to pull" is exactly one base unit of USDC above what is left. One base unit is $0.000001.
- **Shot 7.** A purchase that was already pulled before the revoke confirmed still completes. The one after it fails. If the errand finishes before the revoke confirms, repeat the take and revoke sooner. As an alternative ending for this shot, open the allowance account on Solana Explorer from "Technical details" before revoking, and reload it after: the account no longer exists.
- **Shot 8.** "Disconnect" returns to the landing page, where the section is. The reload clears the finished errand from the page.

## Words to keep exact

- Say "real USDC on Solana mainnet". Never say "test money" for this recording.
- Say "Solana's Subscriptions and Allowances program" or "Solana's program" for the limit. Do not say that Petty Cash itself was audited.
- Say "verified by a QuickNode Stream" only while a "Verified" stamp is on screen.
- Do not say that a refund always happens. Say "if a payment does not complete, the money is returned". A seller that takes the payment and fails to deliver keeps it.

## Optional extra, if a take runs short

The landing page has a suggestion "Read the trap page and tell me what it says". It sends the agent to a page of the app that contains hostile instructions for AI agents. The agent pays to read the page and summarises it. The rule check and the onchain limit do not depend on what any page says. Suggested line: "This page tells the agent to ignore its limits and send the money away. It can't. The limits are code and chain state, not instructions."
