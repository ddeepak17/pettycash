// Renders title cards, captions and badges to PNG files with a real browser, for scripts/video/assemble.py.
//   pnpm tsx scripts/video/render-text.ts <render.json>
// render.json: [{ file, kind: "card" | "caption" | "badge", text, sub? }]
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const items = JSON.parse(readFileSync(process.argv[2], "utf8")) as { file: string; kind: "card" | "caption" | "badge"; text: string; sub?: string }[];
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const base = `*{box-sizing:border-box;margin:0}html,body{width:1920px;height:1080px;background:transparent;font-family:-apple-system,"Helvetica Neue",Helvetica,Arial,sans-serif;color:#1c1b19}`;

function html(it: (typeof items)[number]): string {
  if (it.kind === "card") return `<style>${base}body{background:#f4eee1;display:flex;flex-direction:column;justify-content:center;padding:0 170px}
    .mark{font-size:44px;font-weight:600;margin-bottom:70px;display:flex;align-items:center;gap:20px}.mark i{width:46px;height:52px;border:5px solid #1c1b19;border-radius:8px;display:block}
    h1{font-size:128px;line-height:1.04;font-weight:600;letter-spacing:-3px;max-width:1500px}p{margin-top:64px;font:500 40px ui-monospace,Menlo,monospace;color:#1f3a93;letter-spacing:1px}</style>
    <div class="mark"><i></i>Petty Cash</div><h1>${esc(it.text)}</h1>${it.sub ? `<p>${esc(it.sub)}</p>` : ""}`;
  if (it.kind === "caption") return `<style>${base}body{display:flex;align-items:flex-end;justify-content:center;padding-bottom:58px}
    div{background:rgba(28,27,25,.9);color:#fbf8f1;font-size:40px;line-height:1.3;font-weight:500;padding:20px 38px;border-radius:14px;max-width:1560px;text-align:center}</style><div>${esc(it.text)}</div>`;
  return `<style>${base}body{display:flex;align-items:flex-start;justify-content:flex-end;padding:36px 44px}
    div{background:rgba(28,27,25,.82);color:#fbf8f1;font:600 26px ui-monospace,Menlo,monospace;padding:10px 18px;border-radius:10px}</style><div>${esc(it.text)}</div>`;
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  for (const it of items) {
    await page.setContent(`<!doctype html><html><body>${html(it)}</body></html>`);
    await page.screenshot({ path: it.file, omitBackground: it.kind !== "card" });
  }
  await browser.close();
  console.log(`rendered ${items.length} images`);
})().catch((e) => { console.error(e); process.exit(1); });
