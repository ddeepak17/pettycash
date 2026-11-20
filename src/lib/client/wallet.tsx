"use client";
// One small wallet interface for the whole UI. Real mode wraps the Solana wallet adapter (Wallet Standard
// auto-detection, so Phantom, Solflare and Backpack appear on their own). Preview mode simulates a wallet.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import type { Connection, Transaction } from "@solana/web3.js";
import { MOCK } from "./api";
import { MOCK_OWNER, mockSleep } from "./mock";

export type WalletOption = { name: string; icon?: string; installed: boolean };
export type AppWallet = {
  address: string | null;
  status: "disconnected" | "connecting" | "connected";
  options: WalletOption[];
  connect: (name: string) => Promise<void>;
  disconnect: () => Promise<void>;
  signMessage: (msg: Uint8Array) => Promise<Uint8Array>;
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>;
};

const Ctx = createContext<AppWallet | null>(null);
export const useAppWallet = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("WalletProvider missing");
  return v;
};

function MockWallet({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [status, setStatus] = useState<AppWallet["status"]>("disconnected");
  const value = useMemo<AppWallet>(() => ({
    address, status,
    options: [{ name: "Preview wallet", installed: true }],
    connect: async () => { setStatus("connecting"); await mockSleep(500); setAddress(MOCK_OWNER); setStatus("connected"); },
    disconnect: async () => { setAddress(null); setStatus("disconnected"); },
    signMessage: async () => { await mockSleep(500); return new Uint8Array(64); },
    sendTransaction: async () => { await mockSleep(900); return "PreviewSignature".padEnd(88, "0"); },
  }), [address, status]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function RealWallet({ children }: { children: ReactNode }) {
  const w = useWallet();
  const [wantConnect, setWant] = useState(false);
  useEffect(() => {
    if (wantConnect && w.wallet && !w.connected && !w.connecting) {
      setWant(false);
      w.connect().catch(() => {});
    }
  }, [wantConnect, w]);
  const connect = useCallback(async (name: string) => {
    const target = w.wallets.find((x) => x.adapter.name === name);
    if (!target) throw new Error("That wallet was not found in this browser.");
    if (target.readyState === WalletReadyState.NotDetected || target.readyState === WalletReadyState.Unsupported) {
      throw new Error("That wallet is not installed in this browser.");
    }
    if (w.wallet?.adapter.name === name) { await w.connect(); return; }
    w.select(target.adapter.name);
    setWant(true);
  }, [w]);
  const value = useMemo<AppWallet>(() => ({
    address: w.publicKey?.toBase58() ?? null,
    status: w.connected ? "connected" : w.connecting ? "connecting" : "disconnected",
    options: w.wallets
      .filter((x) => x.readyState !== WalletReadyState.Unsupported)
      .map((x) => ({ name: x.adapter.name, icon: x.adapter.icon, installed: x.readyState === WalletReadyState.Installed || x.readyState === WalletReadyState.Loadable }))
      .sort((a, b) => Number(b.installed) - Number(a.installed)),
    connect,
    disconnect: () => w.disconnect(),
    signMessage: async (msg) => {
      if (!w.signMessage) throw new Error("This wallet cannot sign messages. Try Phantom, Solflare or Backpack.");
      return w.signMessage(msg);
    },
    sendTransaction: (tx, c) => w.sendTransaction(tx, c),
  }), [w, connect]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function AppWalletProvider({ children }: { children: ReactNode }) {
  if (MOCK) return <MockWallet>{children}</MockWallet>;
  return (
    <WalletProvider wallets={[]} autoConnect localStorageKey="pettycash-wallet">
      <RealWallet>{children}</RealWallet>
    </WalletProvider>
  );
}
