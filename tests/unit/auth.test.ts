import { beforeAll, describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";

beforeAll(() => { process.env.SESSION_SECRET = "unit-test-secret-unit-test-secret"; });
const load = () => import("../../src/lib/server/auth");
const HOST = "pettycash.example";
const sign = (message: string, k: Keypair) => Buffer.from(nacl.sign.detached(new TextEncoder().encode(message), k.secretKey)).toString("base64");

describe("wallet sign-in", () => {
  it("accepts a challenge signed by the wallet it names", async () => {
    const { makeChallenge, verifyChallenge } = await load();
    const k = Keypair.generate(), owner = k.publicKey.toBase58();
    const { message } = makeChallenge(owner, HOST);
    expect(message.startsWith(`${HOST} wants you to sign in`)).toBe(true);
    expect(verifyChallenge(owner, HOST, message, sign(message, k))).toBe(true);
  });
  it("rejects a signature from another wallet", async () => {
    const { makeChallenge, verifyChallenge } = await load();
    const k = Keypair.generate(), other = Keypair.generate(), owner = k.publicKey.toBase58();
    const { message } = makeChallenge(owner, HOST);
    expect(verifyChallenge(owner, HOST, message, sign(message, other))).toBe(false);
  });
  it("rejects a challenge issued for a different wallet", async () => {
    const { makeChallenge, verifyChallenge } = await load();
    const k = Keypair.generate(), other = Keypair.generate();
    const { message } = makeChallenge(other.publicKey.toBase58(), HOST);
    expect(verifyChallenge(k.publicKey.toBase58(), HOST, message, sign(message, k))).toBe(false);
  });
  it("rejects a message we did not issue, even when correctly signed", async () => {
    const { verifyChallenge } = await load();
    const k = Keypair.generate(), owner = k.publicKey.toBase58();
    const forged = `${HOST} wants you to sign in to Petty Cash with your Solana account:\n${owner}\n\nThis proves the wallet is yours. It is free and is not a transaction.\n\nSite: ${HOST}\nNonce: abc\nExpires: ${Date.now() + 60_000}\nTag: forged`;
    expect(verifyChallenge(owner, HOST, forged, sign(forged, k))).toBe(false);
  });
  it("rejects an expired challenge", async () => {
    const { makeChallenge, verifyChallenge } = await load();
    const k = Keypair.generate(), owner = k.publicKey.toBase58();
    const { message } = makeChallenge(owner, HOST, Date.now() - 10 * 60_000);
    expect(verifyChallenge(owner, HOST, message, sign(message, k))).toBe(false);
  });
  it("rejects a challenge that was issued for a different site (a phishing page relaying our challenge)", async () => {
    const { makeChallenge, verifyChallenge } = await load();
    const k = Keypair.generate(), owner = k.publicKey.toBase58();
    const { message } = makeChallenge(owner, "evil.example");
    expect(verifyChallenge(owner, HOST, message, sign(message, k))).toBe(false);
  });
  it("session cookies round-trip and reject tampering and expiry", async () => {
    const { makeSession, readSession } = await load();
    const owner = Keypair.generate().publicKey.toBase58();
    const { value } = makeSession(owner);
    expect(readSession(value)).toBe(owner);
    expect(readSession(`${value}x`)).toBeNull();
    const [body, tag] = value.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ o: Keypair.generate().publicKey.toBase58(), e: Date.now() + 1e9 })).toString("base64url");
    expect(readSession(`${forgedBody}.${tag}`)).toBeNull();
    expect(readSession(`${body}.`)).toBeNull();
    expect(readSession(makeSession(owner, Date.now() - 13 * 60 * 60_000).value)).toBeNull();
    expect(readSession(undefined)).toBeNull();
  });
  it("same-origin check refuses a foreign Origin", async () => {
    const { sameOrigin } = await load();
    expect(sameOrigin(new Request("https://pettycash.example/api/run", { method: "POST", headers: { origin: "https://evil.example", host: "pettycash.example" } }))).toBe(false);
    expect(sameOrigin(new Request("https://pettycash.example/api/run", { method: "POST", headers: { origin: "https://pettycash.example", host: "pettycash.example" } }))).toBe(true);
  });
});
