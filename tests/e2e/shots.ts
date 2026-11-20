// Takes screenshots of the deployed (or local) app in a real Chrome. Usage: pnpm tsx tests/e2e/shots.ts <baseUrl> <outDir>
import { chromium } from "playwright-core";
const [base = "http://127.0.0.1:3000", out = "qa/live"] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const errors: string[] = [];
  for (const [name, width, height] of [["1440", 1440, 900], ["390", 390, 844]] as const) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on("console", (m) => { if (m.type() === "error") errors.push(`[${name}] ${m.text().slice(0, 200)}`); });
    page.on("pageerror", (e) => errors.push(`[${name}] pageerror ${e.message.slice(0, 200)}`));
    await page.goto(base, { waitUntil: "networkidle" });
    await page.waitForSelector("h1", { timeout: 20000 });
    await page.screenshot({ path: `${out}/${name}-landing.png`, fullPage: true });
    await page.goto(`${base}/trap`, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${out}/${name}-trap.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    console.log(JSON.stringify({ viewport: name, horizontalOverflow: overflow }));
    await page.close();
  }
  console.log(JSON.stringify({ consoleErrors: errors }));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
