// A Wallet Standard wallet for automated browser tests. It appears in the app's wallet list like Phantom does,
// but signing happens in the Node test process (the secret key never enters the page). TEST TOOLING ONLY.
import type { Page } from "playwright-core";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

export async function installTestWallet(page: Page, keypair: Keypair, opts: { name?: string; log?: (line: string) => void } = {}) {
  const log = opts.log ?? (() => {});
  await page.exposeFunction("__pcTestSign", (messageB64: string, what: string) => {
    log(`wallet asked to sign: ${what}`);
    return Buffer.from(nacl.sign.detached(Buffer.from(messageB64, "base64"), keypair.secretKey)).toString("base64");
  });
  await page.addInitScript(({ address, publicKey, name }) => {
    const b64 = (u: Uint8Array) => { let s = ""; u.forEach((b) => (s += String.fromCharCode(b))); return btoa(s); };
    const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    const pk = Uint8Array.from(publicKey);
    const sign = async (bytes: Uint8Array, what: string) => unb64(await (window as unknown as { __pcTestSign: (m: string, w: string) => Promise<string> }).__pcTestSign(b64(bytes), what));
    const chains = ["solana:mainnet", "solana:devnet"];
    const account = { address, publicKey: pk, chains, features: ["solana:signTransaction", "solana:signMessage"] };
    const listeners: ((p: unknown) => void)[] = [];
    const wallet = {
      version: "1.0.0", name, chains, accounts: [] as unknown[],
      icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMCAxMCI+PHJlY3Qgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjMjIyIi8+PC9zdmc+",
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => { wallet.accounts = [account]; listeners.forEach((l) => l({ accounts: wallet.accounts })); return { accounts: wallet.accounts }; } },
        "standard:disconnect": { version: "1.0.0", disconnect: async () => { wallet.accounts = []; listeners.forEach((l) => l({ accounts: [] })); } },
        "standard:events": { version: "1.0.0", on: (_event: string, listener: (p: unknown) => void) => { listeners.push(listener); return () => { const i = listeners.indexOf(listener); if (i >= 0) listeners.splice(i, 1); }; } },
        "solana:signMessage": {
          version: "1.0.0",
          signMessage: async (...inputs: { message: Uint8Array }[]) => Promise.all(inputs.map(async (i) => ({ signedMessage: i.message, signature: await sign(i.message, "message") }))),
        },
        "solana:signTransaction": {
          version: "1.0.0", supportedTransactionVersions: ["legacy", 0],
          signTransaction: async (...inputs: { transaction: Uint8Array }[]) => Promise.all(inputs.map(async (i) => {
            const tx = Uint8Array.from(i.transaction);
            const count = tx[0]; // compact-u16; our transactions have fewer than 128 signatures
            const message = tx.subarray(1 + 64 * count);
            // Find this wallet among the required signers (legacy or version-0 message).
            const offset = message[0] & 0x80 ? 1 : 0;
            const required = message[offset];
            const keysAt = offset + 3 + 1; // header (3 bytes) + compact-u16 account count (1 byte for small transactions)
            let index = -1;
            for (let k = 0; k < required; k++) if (pk.every((b, j) => message[keysAt + 32 * k + j] === b)) index = k;
            if (index < 0) throw new Error("test wallet is not a signer of this transaction");
            tx.set(await sign(message, "transaction"), 1 + 64 * index);
            return { signedTransaction: tx };
          })),
        },
      },
    };
    const register = (api: { register: (w: unknown) => void }) => api.register(wallet);
    class RegisterEvent extends Event {
      constructor() { super("wallet-standard:register-wallet", { bubbles: false, cancelable: false, composed: false }); }
      get detail() { return register; }
    }
    window.dispatchEvent(new RegisterEvent());
    window.addEventListener("wallet-standard:app-ready", (e) => register((e as CustomEvent).detail));
  }, { address: keypair.publicKey.toBase58(), publicKey: Array.from(keypair.publicKey.toBytes()), name: opts.name ?? "Test Wallet" });
  void bs58;
}
