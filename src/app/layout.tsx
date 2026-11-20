import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

const site = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000";
const description = "Set aside a small budget and let an AI agent run an errand. It pays real companies a fraction of a cent at a time, and Solana itself makes sure it can never spend more than you set aside.";
export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: { default: "Petty Cash: give your AI petty cash, not your wallet", template: "%s | Petty Cash" },
  description,
  openGraph: { title: "Petty Cash", description, type: "website", siteName: "Petty Cash" },
  twitter: { card: "summary_large_image", title: "Petty Cash", description },
  icons: { icon: "/icon.svg" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
