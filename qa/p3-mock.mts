import { chromium } from "playwright-core";
const OUT = "/Users/darrendeepak/pettycash-ui/qa";
const b = await chromium.launch({ channel: "chrome", headless: true });
for (const [tag, w, h] of [["1440", 1440, 900], ["390", 390, 844]] as const) {
  const page = await (await b.newContext({ viewport: { width: w, height: h } })).newPage();
  await page.goto("http://localhost:3311/", { waitUntil: "networkidle" });
  await page.locator("#check").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/p3-mock-${tag}-check.png` });
  await page.locator("#feed").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/p3-mock-${tag}-receipts.png` });
  console.log(tag, "overflow", await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  await page.goto("http://localhost:3311/r/00000000-0000-0000-0000-000000000000", { waitUntil: "networkidle" });
}
await b.close();
