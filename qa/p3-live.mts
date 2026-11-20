// QA script: real-mode checks against the live site. Run with tsx. Never sends a transaction.
import { Keypair } from "@solana/web3.js";
import { installTestWallet } from "../tests/e2e/test-wallet.ts";
import { chromium } from "playwright-core";
const BASE = process.env.BASE ?? "https://pettycash-pink.vercel.app";
const OUT = "/Users/darrendeepak/pettycash-ui/qa";
const b = await chromium.launch({ channel: "chrome", headless: true });
for (const [tag, w, h] of [["1440", 1440, 900], ["390", 390, 844]] as const) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  const issues: string[] = [];
  page.on("console", (m: any) => { if (m.type() === "error") issues.push("console: " + m.text().slice(0, 160)); });
  page.on("pageerror", (e: any) => issues.push("pageerror: " + String(e).slice(0, 160)));
  page.on("response", (r: any) => { if (r.status() >= 400) issues.push(`http ${r.status()} ${r.url()}`); });
  page.on("requestfailed", (r: any) => issues.push("failed " + r.url()));
  const ov = async (n: string, pg = page) => console.log(tag, n, "overflow:", await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  for (const [n, path] of [["landing", "/"], ["trap", "/trap"], ["notfound", "/r/00000000-0000-0000-0000-000000000000"]]) {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/p3-${tag}-${n}.png`, fullPage: true });
    await ov(n);
  }
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/p3-${tag}-connect-nowallet.png` });
  await ctx.close();

  const ctx2 = await b.newContext({ viewport: { width: w, height: h } });
  const p2 = await ctx2.newPage();
  p2.on("console", (m: any) => { if (m.type() === "error") issues.push("w-console: " + m.text().slice(0, 160)); });
  p2.on("response", (r: any) => { if (r.status() >= 400) issues.push(`w-http ${r.status()} ${r.url()}`); });
  await p2.addInitScript("window.__name = (f) => f;");
  await installTestWallet(p2, Keypair.generate());
  await p2.goto(BASE + "/", { waitUntil: "networkidle" });
  await p2.getByRole("button", { name: "Connect wallet" }).click();
  await p2.screenshot({ path: `${OUT}/p3-${tag}-connect-list.png` });
  await p2.getByRole("button", { name: /Test Wallet/ }).click();
  await p2.getByText("Nothing set aside yet").waitFor({ timeout: 20000 });
  await p2.waitForTimeout(500);
  await p2.screenshot({ path: `${OUT}/p3-${tag}-connected-empty.png`, fullPage: true });
  await p2.getByRole("button", { name: "Set aside petty cash" }).click();
  await p2.waitForTimeout(400);
  await p2.screenshot({ path: `${OUT}/p3-${tag}-newcash.png` });
  const focusIn = async () => p2.evaluate(() => !!document.activeElement?.closest("dialog") || document.activeElement === document.body);
  let trapped = true;
  for (let i = 0; i < 12; i++) { await p2.keyboard.press("Tab"); if (!(await focusIn())) trapped = false; }
  console.log(tag, "focus trapped in dialog:", trapped);
  await p2.getByRole("button", { name: "$5.00" }).click();
  await p2.screenshot({ path: `${OUT}/p3-${tag}-newcash-5.png` });
  await p2.locator("#amt").focus(); await p2.keyboard.press("Enter");
  await p2.waitForTimeout(500);
  await p2.keyboard.press("Escape");
  await p2.waitForTimeout(300);
  console.log(tag, "dialog closed by Escape:", !(await p2.locator("dialog[open]").count()));
  await p2.getByRole("button", { name: "Disconnect" }).click();
  await p2.waitForTimeout(500);
  await p2.screenshot({ path: `${OUT}/p3-${tag}-disconnected.png` });
  await ov("wallet pages", p2);
  console.log(tag, "issues:", [...new Set(issues)]);
  await ctx2.close();
}
await b.close();
