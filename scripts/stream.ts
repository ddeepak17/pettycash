// QuickNode Streams control for Petty Cash. Manages ONE stream, found by its name: "pettycash-mainnet".
// Every other stream on the account is left alone (list only shows them).
// Billing is per processed block, so the stream stays PAUSED outside purchases and demos.
// Nothing here prints the API key, the webhook URL or the security token.
//
//   pnpm tsx scripts/stream.ts create <webhookUrl>   create the stream PAUSED; token and id go to .env.local
//   pnpm tsx scripts/stream.ts get                   status of pettycash-mainnet
//   pnpm tsx scripts/stream.ts list                  id, name and status of every stream on the account
//   pnpm tsx scripts/stream.ts activate              move start_range to the chain tip, then activate
//   pnpm tsx scripts/stream.ts pause
//   pnpm tsx scripts/stream.ts set-url <webhookUrl>  change the destination (same security token)
//   pnpm tsx scripts/stream.ts set-filter            upload infra/quicknode/filter.js again
//   pnpm tsx scripts/stream.ts test-filter <slot>    run the filter on one real mainnet block in QuickNode's sandbox
//   pnpm tsx scripts/stream.ts delete
//
// QUICKNODE_API_KEY comes from the environment or, if absent, from the team's existing env file.
// AGENT_PUBLIC_KEY (optional) replaces the agent key inside the filter; test-filter uses it to try other accounts.
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STREAM_DATASET, STREAM_NAME, STREAM_NETWORK, activateAtTip, isOurStream, mainnetTip, pauseStream, qnError, qnRequest, summarize,
} from "../src/lib/stream/control";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = join(ROOT, ".env.local");
const FILTER_FILE = join(ROOT, "infra", "quicknode", "filter.js");
const FALLBACK_KEY_FILE = "/Users/darrendeepak/solsend/apps/web/.env.local";
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Reads one KEY=value from an env file without loading anything else from it. */
function readEnvVar(file: string, key: string): string | undefined {
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m && m[1] === key) return m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return undefined;
}

/** Rewrites or appends KEY=value in .env.local (gitignored), readable by the owner only. Pass null to remove. */
function writeEnvVar(key: string, value: string | null): void {
  const lines = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8").split("\n") : [];
  const kept = lines.filter((l) => !l.startsWith(`${key}=`));
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  if (value !== null) kept.push(`${key}=${value}`);
  writeFileSync(ENV_FILE, `${kept.join("\n")}\n`, { mode: 0o600 });
  chmodSync(ENV_FILE, 0o600);
}

function apiKey(): string {
  const key = process.env.QUICKNODE_API_KEY || readEnvVar(ENV_FILE, "QUICKNODE_API_KEY") || readEnvVar(FALLBACK_KEY_FILE, "QUICKNODE_API_KEY");
  if (!key) throw new Error("QUICKNODE_API_KEY is not set");
  return key;
}

/** The filter source with the agent key in place. */
function filterSource(): string {
  const source = readFileSync(FILTER_FILE, "utf8");
  const agent = process.env.AGENT_PUBLIC_KEY;
  if (!agent) return source;
  if (!ADDRESS.test(agent)) throw new Error("AGENT_PUBLIC_KEY is not a Solana address");
  const line = /^const AGENT = "[1-9A-HJ-NP-Za-km-z]{32,44}";$/gm;
  if ((source.match(line) ?? []).length !== 1) throw new Error("filter.js must contain exactly one `const AGENT = \"...\";` line");
  return source.replace(line, `const AGENT = "${agent}";`);
}
const filterBase64 = () => Buffer.from(filterSource(), "utf8").toString("base64");

const show = (o: unknown) => console.log(JSON.stringify(o, null, 1));

/* eslint-disable @typescript-eslint/no-explicit-any */
async function listStreams(): Promise<any[]> {
  const r = await qnRequest(apiKey(), "GET", "/streams?limit=100");
  if (r.status >= 300) throw new Error(`could not list streams (${qnError(r)})`);
  return Array.isArray(r.json) ? r.json : r.json?.data ?? [];
}

/** The one stream this tool may change. Found by name and network, never by an id typed on the command line. */
async function ours(): Promise<any> {
  const found = (await listStreams()).filter(isOurStream);
  if (found.length === 0) throw new Error(`no stream named ${STREAM_NAME} on ${STREAM_NETWORK}; run create first`);
  if (found.length > 1) throw new Error(`more than one stream is named ${STREAM_NAME}; resolve that in the QuickNode dashboard`);
  return found[0];
}

function destination(url: string, token: string) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("the webhook URL is not a valid URL"); }
  if (parsed.protocol !== "https:") throw new Error("the webhook URL must be https");
  return { url, compression: "none", headers: {}, max_retry: 3, retry_interval_sec: 1, post_timeout_sec: 10, security_token: token };
}

async function current(id: string) {
  const r = await qnRequest(apiKey(), "GET", `/streams/${id}`);
  return { http: r.status, ...summarize(r.json) };
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  switch (cmd) {
    case "list":
      return show((await listStreams()).map((s) => ({ ...summarize(s), managedByThisTool: isOurStream(s) })));

    case "get":
      return show(await current((await ours()).id));

    case "create": {
      if (!arg) throw new Error("usage: create <webhookUrl>");
      const existing = await listStreams();
      if (existing.some((s) => s.name === STREAM_NAME)) throw new Error(`${STREAM_NAME} already exists (use set-url, set-filter or delete)`);
      const token = randomBytes(32).toString("hex");
      const body = {
        name: STREAM_NAME, network: STREAM_NETWORK, dataset: STREAM_DATASET,
        filter_function: filterBase64(), filter_language: "javascript",
        // QuickNode rejects a batch size under 5 for an open-ended solana-mainnet stream (HTTP 422). Elastic batching
        // delivers whatever blocks are ready (1 to 5) instead of waiting for five, so the filter sees 1..5 blocks a call.
        region: "usa_east", dataset_batch_size: 5, elastic_batch_enabled: true, external_id: STREAM_NAME,
        start_range: await mainnetTip(), end_range: -1, keep_distance_from_tip: 0, fix_block_reorgs: 0,
        destination: "webhook", status: "paused", destination_attributes: destination(arg, token),
      };
      // Saved before the call so a created stream's token can never be lost; never printed. If QuickNode refuses,
      // the file goes back to what it held, so a token that belongs to no stream is not left lying around.
      const previousToken = readEnvVar(ENV_FILE, "QN_STREAM_SECURITY_TOKEN") ?? null;
      writeEnvVar("QN_STREAM_SECURITY_TOKEN", token);
      const r = await qnRequest(apiKey(), "POST", "/streams", body);
      if (r.status >= 300 || !r.json?.id) {
        writeEnvVar("QN_STREAM_SECURITY_TOKEN", previousToken);
        process.exitCode = 1;
        return show({ created: false, error: qnError(r), otherStreamsUntouched: existing.map((s) => `${s.name} (${s.status})`) });
      }
      const id: string = r.json.id;
      writeEnvVar("QN_STREAM_ID", id);
      // Safety: a new stream must not be left running.
      const made = (await qnRequest(apiKey(), "GET", `/streams/${id}`)).json;
      if (made?.status !== "paused" && isOurStream(made)) await pauseStream(apiKey(), made);
      return show({ created: true, ...(await current(id)), savedTo: ".env.local (QN_STREAM_SECURITY_TOKEN, QN_STREAM_ID)" });
    }

    case "activate": {
      const s = await ours();
      if (s.status === "active") return show({ note: "already active", ...(await current(s.id)) });
      const r = await activateAtTip(apiKey(), s);
      return show({ activatedFromSlot: r.startRange, ...(await current(s.id)) });
    }

    case "pause": {
      const s = await ours();
      await pauseStream(apiKey(), s);
      return show(await current(s.id));
    }

    case "set-url": {
      if (!arg) throw new Error("usage: set-url <webhookUrl>");
      const token = process.env.QN_STREAM_SECURITY_TOKEN || readEnvVar(ENV_FILE, "QN_STREAM_SECURITY_TOKEN");
      if (!token) throw new Error("QN_STREAM_SECURITY_TOKEN is not in .env.local; cannot keep the same token");
      const s = await ours();
      const r = await qnRequest(apiKey(), "PATCH", `/streams/${s.id}`, { destination_attributes: destination(arg, token) });
      if (r.status >= 300) throw new Error(`could not change the destination (${qnError(r)})`);
      return show({ destinationChanged: true, ...(await current(s.id)) });
    }

    case "set-filter": {
      const s = await ours();
      const r = await qnRequest(apiKey(), "PATCH", `/streams/${s.id}`, { filter_function: filterBase64(), filter_language: "javascript" });
      if (r.status >= 300) throw new Error(`could not upload the filter (${qnError(r)})`);
      return show({ filterUploaded: true, ...(await current(s.id)) });
    }

    case "test-filter": {
      if (!arg || !/^\d+$/.test(arg)) throw new Error("usage: test-filter <slot>");
      const r = await qnRequest(apiKey(), "POST", "/streams/test_filter", { network: STREAM_NETWORK, dataset: STREAM_DATASET, filter_function: filterBase64(), block: arg });
      // The result is the filter's output for public chain data; QuickNode's own fields carry no secrets of ours.
      return show({ http: r.status, slot: Number(arg), result: r.json?.result ?? null, logs: r.json?.logs ?? null, error: r.status >= 300 ? qnError(r) : null });
    }

    case "delete": {
      const s = await ours();
      const r = await qnRequest(apiKey(), "DELETE", `/streams/${s.id}`);
      if (r.status >= 300) throw new Error(`could not delete the stream (${qnError(r)})`);
      writeEnvVar("QN_STREAM_ID", null);
      return show({ deleted: s.id, name: s.name });
    }

    default:
      console.error("commands: create <webhookUrl> | get | list | activate | pause | set-url <url> | set-filter | test-filter <slot> | delete");
      process.exitCode = 2;
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : "failed"); process.exit(1); });
