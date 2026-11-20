// Drives the real product in a real Chrome and saves screenshots. This spends REAL money on mainnet (cents).
//
//   pnpm tsx tests/e2e/journey.ts house  <baseUrl> "<errand>"          no wallet: the public demo petty cash
//   pnpm tsx tests/e2e/journey.ts wallet <baseUrl> "<errand>" <amount>  own wallet: set aside, run, test the limit, revoke
//
// The wallet journey uses a test wallet (tests/e2e/test-wallet.ts) backed by the keypair in OWNER_KEYPAIR
// (default ~/.config/pettycash/mainnet/owner.json). Signing happens in this process, not in the page.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";
import { Keypair } from "@solana/web3.js";
import { installTestWallet } from "./test-wallet";

const [mode = "house", base = "http://127.0.0.1:3000", task = "What is the weather in Austin this weekend, and do I need a jacket?", amount = "0.10"] = process.argv.slice(2);
const out = `qa/journey-${mode}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
mkdirSync(out, { recursive: true });
const log: string[] = [];
const note = (line: string) => { log.push(`${new Date().toISOString()} ${line}`); console.log(line); };
let shot = 0;
const snap = async (page: Page, name: string) => { const file = `${out}/${String(++shot).padStart(2, "0")}-${name}.png`; await page.screenshot({ path: file, fullPage: true }); note(`screenshot ${file}`); };

async function runErrand(page: Page, buttonLabel: RegExp) {
  await page.locator("#task").fill(task);
  await page.getByRole("button", { name: buttonLabel }).click();
  note(`errand started: ${task}`);
  const started = Date.now();
  let approvals = 0;
  // Until the run ends: approve any purchase that asks.
  for (;;) {
    if (Date.now() - started > 280_000) throw new Error("errand did not finish in time");
    const approve = page.getByRole("button", { name: /^Approve/ });
    if (await approve.count()) { await snap(page, `approval-${++approvals}`); await approve.first().click(); note("approved a purchase that asked"); }
    if (await page.getByTestId("run-end").count()) break;
    if (await page.getByText(/^Stopped\./).count() || await page.getByTestId("run-tape").getByRole("alert").count()) break;
    await page.waitForTimeout(1000);
  }
  note(`errand ended after ${Math.round((Date.now() - started) / 1000)}s`);
  await snap(page, "errand-finished");
  // Receipts turn verified only when the Stream's own data arrives and matches.
  const waitFrom = Date.now();
  let verified = 0, total = 0;
  while (Date.now() - waitFrom < 100_000) {
    total = await page.locator("text=/Waiting for independent confirmation|Verified by QuickNode Streams/").count();
    verified = await page.getByText("Verified by QuickNode Streams").count();
    if (total > 0 && verified >= total) break;
    await page.waitForTimeout(2000);
  }
  note(`receipts verified by the Stream: ${verified} of ${total} after ${Math.round((Date.now() - waitFrom) / 1000)}s`);
  await snap(page, "receipts");
  const links = await page.locator('a[href*="explorer.solana.com/tx/"]').evaluateAll((as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).href))]);
  note(`explorer links on the page: ${links.length}`);
  return { verified, total, links, answer: await page.locator("text=/^Answer$/i").count() };
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  // RECORD=1 also saves a 1920x1080 video of the journey (needs `pnpm exec playwright-core install ffmpeg` once).
  const record = process.env.RECORD === "1";
  const context = await browser.newContext(record ? { viewport: { width: 1920, height: 1080 }, recordVideo: { dir: out, size: { width: 1920, height: 1080 } } } : { viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror ${e.message.slice(0, 300)}`));
  let result: Record<string, unknown> = {};
  try {
    if (mode === "wallet") {
      const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.OWNER_KEYPAIR ?? join(homedir(), ".config/pettycash/mainnet/owner.json"), "utf8"))));
      await installTestWallet(page, keypair, { log: note });
      await page.goto(base, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Connect wallet" }).click();
      await page.getByRole("button", { name: /Test Wallet/ }).click();
      await page.getByRole("complementary", { name: "Your petty cash" }).waitFor({ timeout: 30_000 });
      await snap(page, "connected");
      await page.getByRole("button", { name: /Set aside petty cash|New petty cash/ }).click();
      const input = page.getByRole("dialog").locator("input").first();
      await input.fill(amount);
      await snap(page, "new-petty-cash");
      await page.getByRole("button", { name: /Continue to wallet/ }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 120_000 });
      await page.getByRole("button", { name: "Test the limit" }).waitFor({ timeout: 60_000 });
      note(`petty cash of $${amount} set aside`);
      const createdText = await page.getByRole("complementary", { name: "Your petty cash" }).locator(".mono, strong, p").first().innerText().catch(() => "");
      await snap(page, "petty-cash-set-aside");
      result = await runErrand(page, /Run on my petty cash/);
      await page.getByRole("button", { name: "Test the limit" }).click();
      await page.getByText(/Solana refused it|did not get refused|could not be run/).waitFor({ timeout: 90_000 });
      note(`limit test: ${(await page.getByText("Solana refused it").count()) ? "Solana refused it" : "NOT refused or could not run"}`);
      await snap(page, "limit-test");
      await page.keyboard.press("Escape");
      // Safety: this journey may only revoke the petty cash it created. A recurring one ("per day") is not ours.
      const box = await page.getByRole("complementary", { name: "Your petty cash" }).innerText();
      if (/per (day|week|period)|every \d+/i.test(box)) throw new Error("the selected petty cash is not the one this journey created; refusing to revoke it");
      await page.waitForTimeout(1500);
      await page.getByRole("button", { name: "Revoke" }).click();
      // Revoked when the petty cash this journey created is no longer shown (the wallet may hold others).
      await page.waitForFunction((amountText) => !document.querySelector('aside[aria-label="Your petty cash"]')?.textContent?.includes(amountText) || !!document.body.textContent?.includes("Nothing set aside yet"), createdText, { timeout: 120_000 }).catch(() => {});
      await page.waitForTimeout(4000);
      note("revoke signed and confirmed");
      await snap(page, "revoked");
    } else {
      await page.goto(base, { waitUntil: "networkidle" });
      await page.getByText("Try it now, on us").waitFor({ timeout: 30_000 });
      await snap(page, "landing");
      result = await runErrand(page, /Run on the house petty cash/);
    }
  } catch (e) {
    note(`FAILED: ${e instanceof Error ? e.message : e}`);
    await snap(page, "failure").catch(() => {});
    process.exitCode = 1;
  }
  note(`console errors: ${consoleErrors.length}`);
  writeFileSync(`${out}/log.json`, JSON.stringify({ mode, base, task, result, consoleErrors, log }, null, 2));
  await context.close();
  await browser.close();
}
main();
