# Recording demo footage

`tests/e2e/record.ts` drives a real Chrome with Playwright and records the screen at 1920x1080. It injects a visible cursor ring (headless shows no pointer), moves the mouse smoothly and pauses so it looks like a person using the product.

## Prerequisites

- `pnpm install`, and Google Chrome installed (the script uses `channel: "chrome"`).
- Playwright's tiny ffmpeg (1.4 MB, free, needed by `recordVideo`), once: `pnpm exec playwright-core install ffmpeg`.
- Output is the `.webm` that Playwright writes. There is no mp4 and no bundled ffmpeg for conversion.

## Commands (real site)

```
pnpm tsx tests/e2e/record.ts <scene> https://pettycash-pink.vercel.app [--out dir] [--headed] [--slow ms] [--chip "text"] [--task "text"]
```

| Scene | What it records | Money | Takes |
|---|---|---|---|
| `tour` | Slow scroll of the landing page, pausing at How it works, Who the agent pays, What stops it from overspending. | None | about 40 s |
| `house` | Pause on the headline, click an errand chip (`--chip "<text>"`; default is the first real errand chip) or type `--task "<text>"` and press Run, wait for the run to end, scroll to the answer, wait up to 100 s for "Verified by QuickNode Streams", hold 4 s. | Real USDC on Solana mainnet (cents), from the public demo budget | 1 to 4 min |
| `limit` | Click "Try to overspend the house petty cash", hold on the dialog 5 s, open the failed transaction on Solana Explorer in the same tab, hold 6 s. | Spends from the public demo budget on mainnet (cents) | about 1 min |
| `trap` | Scroll through `/trap`, go back, click "Read the trap page and tell me what it says", wait for the run, hold on the answer. | Real mainnet spend (cents) from the public demo budget | 1 to 4 min |

`house`, `limit` and `trap` spend real money on Solana mainnet. Run them deliberately, not in loops. Default output: `qa/recordings/<timestamp>-<scene>/` containing `<scene>.webm` and `log.json` (clicks with ms offsets, whether a verified stamp was seen, explorer links, console errors). The script prints the video path and an approximate duration. Use `--headed` to watch.

## Honesty rule

The script only records what the page shows. It refuses to run if the page shows "Preview data. Nothing on this page is a real payment." (mock mode) unless `--allow-mock` is passed, and `--allow-mock` footage is for testing the tool only, never for the submission. If no verified stamp appears within 100 s the script prints a warning and `log.json` has `verifiedStampSeen: false`: never describe that footage as showing a verified receipt. Check `log.json` before using a clip.

## Converting

YouTube accepts `.webm` directly. For mp4: `brew install ffmpeg` then `ffmpeg -i house.webm -c:v libx264 -pix_fmt yuv420p house.mp4`, or use the free HandBrake app.

## Testing the tool without spending

`NEXT_PUBLIC_MOCK=1 pnpm dev --port 3344`, then run scenes with `http://127.0.0.1:3344 --allow-mock --out qa/recordings/mock-test/<scene>`. Do not commit videos.

## Putting the recordings together

`scripts/video/assemble.py` turns recordings into one captioned, narrated 1080p video. It only trims, changes speed (never slower than real time; a "sped up" badge appears when faster), and adds captions and a voice. It cannot create footage.

```bash
brew install ffmpeg                                   # once
python3 scripts/video/assemble.py qa/recordings/plan.json out.mp4
```

The plan is a JSON list of segments: a recording (`clip`, `start`, `use` seconds) or a title card (`card`, `sub`), the narration (`say`) and an optional `caption`. Narration uses the macOS `say` voice named in the plan, so it is a computer voice: a person's voice recorded over the same footage is better. Title cards and captions are rendered with Chrome because the Homebrew build of ffmpeg has no text filter.

The own-wallet scene comes from `RECORD=1 pnpm tsx tests/e2e/journey.ts wallet <url> "<errand>" <amount>`. It uses a test wallet that signs automatically, and the video's caption says so. Never run that journey with a wallet that also owns the public demo petty cash unless you have read the safety check in the script.
