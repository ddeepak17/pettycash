"use client";
import { AppWalletProvider } from "@/lib/client/wallet";
import App from "@/components/App";
import { Ribbon } from "@/components/TopBar";

export default function Home() {
  return (
    <AppWalletProvider>
      <Ribbon />
      <App />
    </AppWalletProvider>
  );
}
