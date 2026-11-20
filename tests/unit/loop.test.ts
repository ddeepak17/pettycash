import { describe, expect, it } from "vitest";
import { parseAction, shrinkResult } from "../../src/lib/agent/loop";
import { cleanInput, SELLERS } from "../../src/lib/agent/catalog";
import { formatUsd, parseUsd } from "../../src/lib/solana/cluster";

describe("reading the model's reply", () => {
  it("reads a buy action", () => expect(parseAction('{"say":"Searching.","action":"buy","tool":"web_search","input":{"query":"tacos"}}')).toEqual({ say: "Searching.", action: "buy", tool: "web_search", input: { query: "tacos" } }));
  it("reads an answer wrapped in prose and code fences", () => {
    const a = parseAction('Sure.\n```json\n{"say":"Done.","action":"answer","answer":"It is {sunny} today."}\n```');
    expect(a).toMatchObject({ action: "answer", answer: "It is {sunny} today." });
  });
  it("handles braces and quotes inside strings", () => expect(parseAction('{"say":"a \\"b\\" }","action":"answer","answer":"x } y"}')).toMatchObject({ answer: "x } y" }));
  it("rejects prose, unknown actions and empty answers", () => {
    expect(parseAction("I think I should search.")).toBeNull();
    expect(parseAction('{"action":"transfer","to":"me","amount":"all"}')).toBeNull();
    expect(parseAction('{"action":"answer","answer":"  "}')).toBeNull();
    expect(parseAction('{"action":"buy"}')).toBeNull();
  });
});

describe("shrinking tool results", () => {
  it("drops binary blobs and trims long text", () => {
    const out = shrinkResult(JSON.stringify({ image: "A".repeat(5000), note: "x".repeat(900) }));
    expect(out).toContain("[binary data omitted]");
    expect(out.length).toBeLessThan(1000);
  });
  it("caps the total size", () => expect(shrinkResult("word ".repeat(5000)).length).toBeLessThanOrEqual(3520));
});

describe("tool input from the model", () => {
  const search = SELLERS.find((s) => s.id === "web_search")!, read = SELLERS.find((s) => s.id === "read_page")!;
  it("keeps only declared parameters", () => expect(cleanInput(search, { query: "tacos", url: "https://evil.example", limit: 9999 })).toEqual({ ok: true, input: { query: "tacos" } }));
  it("requires required parameters", () => expect(cleanInput(search, {}).ok).toBe(false));
  it("rejects non-web addresses for page reads", () => {
    expect(cleanInput(read, { url: "file:///etc/passwd" }).ok).toBe(false);
    expect(cleanInput(read, { url: "not a url" }).ok).toBe(false);
    expect(cleanInput(read, { url: "https://solana.com/news" }).ok).toBe(true);
  });
  it("every seller builds a request to its own pinned host only", () => {
    for (const s of SELLERS) {
      const req = s.build(Object.fromEntries(s.params.map((p) => [p.name, p.example])));
      expect(new URL(req.url).host).toBe(s.host);
      expect(new URL(req.url).protocol).toBe("https:");
    }
  });
});

describe("money formatting", () => {
  it("never rounds a real amount to zero", () => {
    expect(formatUsd("1000")).toBe("$0.001");
    expect(formatUsd("1")).toBe("$0.000001");
    expect(formatUsd("1250000")).toBe("$1.25");
    expect(formatUsd("30000")).toBe("$0.03");
    expect(formatUsd(0n)).toBe("$0.00");
    expect(formatUsd("1234567890")).toBe("$1,234.56789");
  });
  it("parses plain dollar amounts and rejects everything else", () => {
    expect(parseUsd("1.25")).toBe(1_250_000n);
    expect(parseUsd("$0.001")).toBe(1000n);
    expect(parseUsd("5")).toBe(5_000_000n);
    expect(parseUsd("-1")).toBeNull();
    expect(parseUsd("1e6")).toBeNull();
    expect(parseUsd("0.0000001")).toBeNull();
    expect(parseUsd("")).toBeNull();
  });
});

describe("finding a delivered image", () => {
  it("accepts a real PNG and rejects look-alikes", async () => {
    const { findImage } = await import("../../src/lib/agent/purchase");
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(3000, 7)]).toString("base64");
    expect(findImage(JSON.stringify({ data: [{ b64_json: png }] }))?.contentType).toBe("image/png");
    expect(findImage(JSON.stringify({ image: `data:image/png;base64,${png}` }))?.contentType).toBe("image/png");
    expect(findImage(JSON.stringify({ image: Buffer.alloc(3000, 65).toString("base64") }))).toBeNull(); // not an image signature
    expect(findImage(JSON.stringify({ html: "<script>alert(1)</script>".repeat(200) }))).toBeNull();
    expect(findImage("not json")).toBeNull();
  });
});
