import { ImageResponse } from "next/og";

export const alt = "Petty Cash: give your AI petty cash, not your wallet.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#f3eee1", color: "#1c1b18", padding: 72, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 38, fontWeight: 700 }}>
          <div style={{ width: 44, height: 52, border: "4px solid #1c1b18", borderRadius: 6, display: "flex", flexDirection: "column", justifyContent: "center", gap: 7, padding: "0 8px" }}>
            <div style={{ height: 4, background: "#1c1b18" }} /><div style={{ height: 4, background: "#1c1b18" }} /><div style={{ height: 4, width: "60%", background: "#1c1b18" }} />
          </div>
          Petty Cash
        </div>
        <div style={{ display: "flex", fontSize: 92, fontWeight: 700, lineHeight: 1.02, letterSpacing: -2, maxWidth: 1000 }}>Give your AI petty cash, not your wallet.</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 28, color: "#5f594b" }}>
          <div style={{ display: "flex" }}>A small budget that Solana itself enforces.</div>
          <div style={{ display: "flex", border: "5px solid #1f3d9c", color: "#1f3d9c", padding: "8px 22px", borderRadius: 10, fontWeight: 700, letterSpacing: 4, transform: "rotate(-4deg)" }}>VERIFIED</div>
        </div>
      </div>
    ),
    size,
  );
}
