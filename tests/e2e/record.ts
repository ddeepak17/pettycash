// Records real footage of the product with Playwright (system Chrome), for the demo video.
//
//   pnpm tsx tests/e2e/record.ts <house|limit|trap|tour> <baseUrl> [--out dir] [--headed] [--slow ms]
//        [--chip "text"] [--task "free text"] [--allow-mock]
//
// Output is the .webm that Playwright's recordVideo writes (no ffmpeg here). The script only records what the
// page really shows. house, limit and trap spend real money on mainnet (cents). See docs/RECORDING.md.
import { mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const valueFlags = new Set(["--out", "--slow", "--chip", "--task"]);
const positional = argv.filter((a, i) => !a.startsWith("--") && !valueFlags.has(argv[i - 1] ?? ""));
const [sceneName = "", base = ""] = positional;
const slow = Number(opt("slow") ?? 1200);
const MOCK_TEXT = "Preview data. Nothing on this page is a real payment.";
const t0 = Date.now();
const clicks: { at: number; what: string }[] = [];
const notes: string[] = [];
const consoleErrors: string[] = [];
const state = { verifiedStampSeen: false };
const say = (s: string) => { notes.push(`${Date.now() - t0}ms ${s}`); console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`); };
const mark = (what: string) => { clicks.push({ at: Date.now() - t0, what }); say(what); };

const CURSOR = `(() => {
  const mk = () => {
    if (document.getElementById("__cur")) return;
    const s = document.createElement("style");
    s.textContent = "@keyframes __pulse{0%{transform:translate(-50%,-50%) scale(1)}40%{transform:translate(-50%,-50%) scale(.6)}100%{transform:translate(-50%,-50%) scale(1)}}";
    const d = document.createElement("div"); d.id = "__cur";
    d.style.cssText = "position:fixed;left:960px;top:540px;width:28px;height:28px;border:3px solid #111;border-radius:50%;background:rgba(255,255,255,.35);box-shadow:0 0 0 2px rgba(255,255,255,.8);pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%)";
    document.documentElement.append(s, d);
    addEventListener("mousemove", (e) => { d.style.left = e.clientX + "px"; d.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", () => { d.style.animation = "none"; void d.offsetWidth; d.style.animation = "__pulse .35s ease-out"; d.style.background = "rgba(0,0,0,.35)"; }, true);
    addEventListener("mouseup", () => { d.style.background = "rgba(255,255,255,.35)"; }, true);
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", mk); else mk();
})();`;

let mouse = { x: 960, y: 540 };
async function moveTo(page: Page, x: number, y: number) {
  const steps = 35;
  await page.mouse.move(x, y, { steps });
  mouse = { x, y };
  await page.waitForTimeout(250);
}
async function clickLoc(page: Page, loc: ReturnType<Page["locator"]>, what: string) {
  const el = loc.first();
  await el.waitFor({ state: "visible", timeout: 30_000 });
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const b = await el.boundingBox();
  if (!b) throw new Error(`no box for ${what}`);
  await moveTo(page, b.x + b.width / 2, b.y + Math.min(b.height / 2, 20));
  await page.waitForTimeout(500);
  mark(`click: ${what}`);
  await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up();
}
async function smoothScroll(page: Page, to: number, ms = 1800) {
  // String form: tsx injects helpers (__name) into function bodies that do not exist in the page.
  await page.evaluate(`new Promise((res) => {
    const from = scrollY, y = ${Math.round(to)}, d = ${ms}, t = performance.now();
    const f = (n) => { const p = Math.min(1, (n - t) / d), e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; scrollTo(0, from + (y - from) * e); if (p < 1) requestAnimationFrame(f); else res(); };
    requestAnimationFrame(f);
  })`);
}
async function scrollToEl(page: Page, loc: ReturnType<Page["locator"]>, ms = 1800) {
  const y = await loc.first().evaluate((e) => Math.max(0, e.getBoundingClientRect().top + scrollY - 120));
  await smoothScroll(page, y, ms);
}
async function guardMock(page: Page) {
  if (await page.getByText(MOCK_TEXT).count()) {
    if (!flag("allow-mock")) throw new Error(`The page shows "${MOCK_TEXT}" (mock data). Refusing to record. Pass --allow-mock only to test this tool.`);
    say("WARNING: mock data on page, this is NOT product footage");
  }
}
async function open(page: Page, url: string) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.mouse.move(mouse.x + 1, mouse.y + 1); // new document: let the cursor ring pick up the pointer position
  await guardMock(page);
}
async function waitRunEnd(page: Page) {
  const start = Date.now();
  while (Date.now() - start < 280_000) {
    if (await page.getByTestId("run-end").count()) { say(`run ended after ${Math.round((Date.now() - start) / 1000)}s`); return true; }
    // Ignore Next's empty route announcer, which also has role=alert.
    const alerts = (await page.getByRole("alert").allInnerTexts()).filter((t) => t.trim());
    if (alerts.length) { say(`an alert appeared; run did not finish normally: ${alerts[0].slice(0, 120)}`); return false; }
    await page.waitForTimeout(1000);
  }
  say("WARNING: run did not end within 280s");
  return false;
}
let stampsBefore = 0;
async function answerAndStamp(page: Page) {
  const end = page.getByTestId("run-end");
  if (await end.count()) await scrollToEl(page, end.first(), 2000);
  await page.waitForTimeout(slow * 2);
  const stamps = page.getByText("Verified by QuickNode Streams");
  const stamp = stamps.first();
  const deadline = Date.now() + 100_000;
  // Only a stamp that appeared after this run started counts (receipts from earlier runs may already be on the page).
  while (Date.now() < deadline) {
    if ((await stamps.count()) > stampsBefore) break;
    await page.waitForTimeout(1000);
  }
  if ((await stamps.count()) > stampsBefore) {
    state.verifiedStampSeen = true;
    await scrollToEl(page, stamp, 1500);
    say("Verified stamp seen; holding 4s");
    await page.waitForTimeout(4000);
  } else {
    say("WARNING: NO verified stamp appeared within 100s. Do NOT describe this footage as showing a verified receipt.");
    console.warn("!!! NO VERIFIED STAMP. Do not describe this footage as showing a verified receipt.");
    await page.waitForTimeout(4000);
  }
}
async function startErrand(page: Page) {
  const task = opt("task");
  if (task) {
    await clickLoc(page, page.locator("#task"), "task box");
    await page.keyboard.type(task, { delay: 70 });
    await page.waitForTimeout(slow);
    await clickLoc(page, page.getByRole("button", { name: "Run on the house petty cash" }), "Run on the house petty cash");
  } else {
    const text = opt("chip");
    const chips = page.locator('[aria-label="Suggested errands"] button.chip');
    const chip = text ? chips.filter({ hasText: text }) : chips.nth(1); // nth(0) is the trap chip; first real errand is next
    await clickLoc(page, chip, `chip: ${text ?? "first errand chip"}`);
  }
}

const scenes: Record<string, (page: Page, base: string) => Promise<void>> = {
  async house(page, base) {
    await open(page, base);
    await page.getByRole("heading", { level: 1 }).waitFor();
    await page.waitForTimeout(slow * 3);
    stampsBefore = await page.getByText("Verified by QuickNode Streams").count();
    await startErrand(page);
    await waitRunEnd(page);
    await answerAndStamp(page);
  },
  async limit(page, base) {
    await open(page, base);
    await page.waitForTimeout(slow * 2);
    await clickLoc(page, page.getByRole("button", { name: "Try to overspend the house petty cash" }), "Try to overspend the house petty cash");
    const dlg = page.getByRole("dialog");
    await dlg.waitFor({ timeout: 60_000 });
    await dlg.getByText(/Solana refused it|error|could not|failed/i).first().waitFor({ timeout: 90_000 }).catch(() => say("WARNING: dialog showed neither refusal nor error text"));
    say("dialog result shown; holding 5s");
    await page.waitForTimeout(5000);
    const link = page.getByRole("link", { name: "Open the failed transaction on Solana Explorer" });
    if (await link.count()) {
      const href = await link.first().getAttribute("href");
      mark(`open explorer in same tab: ${href}`);
      await page.goto(href!, { waitUntil: "load" });
      await page.waitForTimeout(6000 + slow);
      say("explorer held 6s");
    } else say("no explorer link in the dialog (simulated or error)");
  },
  async trap(page, base) {
    await open(page, base);
    await page.waitForTimeout(slow * 2);
    await page.goto(new URL("/trap", base).toString(), { waitUntil: "networkidle" });
    await page.waitForTimeout(slow * 2);
    const h = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    for (let y = 0; y < h; y += 350) { await smoothScroll(page, y, 1500); await page.waitForTimeout(slow); }
    await page.waitForTimeout(slow);
    mark("go back to the landing page");
    await page.goBack({ waitUntil: "networkidle" });
    await page.waitForSelector("h1");
    await page.waitForTimeout(slow * 2);
    await guardMock(page);
    await clickLoc(page, page.locator('[aria-label="Suggested errands"] button.chip', { hasText: "Read the trap page and tell me what it says" }), "chip: Read the trap page");
    await waitRunEnd(page);
    // End on the answer itself: its last line says what the page tried to make the agent do.
    const answer = page.getByTestId("answer");
    const end = page.getByTestId("run-end");
    if (await answer.count()) await scrollToEl(page, answer.first(), 2000);
    else if (await end.count()) await scrollToEl(page, end.first(), 2000);
    mark("holding on the answer");
    await page.waitForTimeout(8000);
  },
  async tour(page, base) {
    await open(page, base);
    await page.waitForTimeout(slow * 3);
    const stops: [string, ReturnType<Page["locator"]>][] = [
      ["How it works", page.getByRole("heading", { name: "How it works" })],
      ["Who the agent pays", page.getByRole("heading", { name: "Who the agent pays" })],
      ["What stops it from overspending", page.getByRole("heading", { name: "What stops it from overspending" })],
    ];
    const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    let y = 0;
    for (const [name, loc] of stops) {
      if (!(await loc.count())) { say(`WARNING: section not found: ${name}`); continue; }
      const target = await loc.first().evaluate((e) => Math.max(0, e.getBoundingClientRect().top + scrollY - 120));
      for (let s = y + 500; s < target; s += 500) { await smoothScroll(page, s, 1200); }
      await smoothScroll(page, target, 1500); y = target;
      say(`pause at: ${name}`);
      await page.waitForTimeout(slow * 3 + 2000);
    }
    for (let s = y + 500; s < total; s += 500) { await smoothScroll(page, s, 1400); await page.waitForTimeout(400); }
    await smoothScroll(page, total, 1200);
    await page.waitForTimeout(slow * 2);
  },
};

async function main() {
  if (!scenes[sceneName] || !/^https?:\/\//.test(base)) {
    console.log(`Usage: pnpm tsx tests/e2e/record.ts <scene> <baseUrl> [--out dir] [--headed] [--slow ms] [--chip text] [--task text] [--allow-mock]\nScenes: ${Object.keys(scenes).join(", ")}`);
    process.exit(scenes[sceneName] ? 1 : 0);
  }
  const out = opt("out") ?? `qa/recordings/${new Date().toISOString().replace(/[:.]/g, "-")}-${sceneName}`;
  mkdirSync(out, { recursive: true });
  const tmp = join(out, "_raw"); mkdirSync(tmp, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: !flag("headed") });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, recordVideo: { dir: tmp, size: { width: 1920, height: 1080 } } });
  await ctx.addInitScript(CURSOR);
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror ${e.message.slice(0, 300)}`));
  let failure: string | undefined;
  let links: string[] = [];
  try {
    await page.mouse.move(960, 540);
    await scenes[sceneName](page, base);
    links = await page.locator('a[href*="explorer.solana.com/tx/"]').evaluateAll((as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).href))]).catch(() => []);
  } catch (e) { failure = (e as Error).message; console.error("FAILED:", failure); }
  const video = page.video();
  await ctx.close();
  await browser.close();
  const raw = await video?.path();
  const final = join(out, `${sceneName}.webm`);
  if (raw) renameSync(raw, final); else { const f = readdirSync(tmp)[0]; if (f) renameSync(join(tmp, f), final); }
  const seconds = (Date.now() - t0) / 1000;
  writeFileSync(join(out, "log.json"), JSON.stringify({ scene: sceneName, baseUrl: base, mock: flag("allow-mock"), clicks, notes, verifiedStampSeen: state.verifiedStampSeen, explorerLinks: links, consoleErrors, failure: failure ?? null, approxDurationSeconds: Math.round(seconds) }, null, 2));
  console.log(`video: ${final}\napprox duration: ${seconds.toFixed(0)}s\nverified stamp seen: ${state.verifiedStampSeen}`);
  if (failure) process.exit(1);
}
main();
