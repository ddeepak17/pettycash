"use client";
import { Fragment, type ReactNode } from "react";
import { useNow } from "@/lib/client/hooks";

export function Spinner({ label }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-muted">
      <span aria-hidden className="inline-block h-3.5 w-3.5 rounded-full border-2 border-ink border-t-transparent animate-spin" />
      {label}
    </span>
  );
}

export function Stamp({ children, sub, bad, fresh }: { children: ReactNode; sub?: ReactNode; bad?: boolean; fresh?: boolean }) {
  return (
    <span className={`stamp ${bad ? "stamp-bad" : ""} ${fresh ? "stamp-new" : ""}`}>
      <span>{children}</span>
      {sub ? <span className="text-[0.58rem] font-semibold tracking-wider opacity-80">{sub}</span> : null}
    </span>
  );
}

export function ErrorNote({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded border border-bad bg-[var(--bad-bg)] px-4 py-3 text-sm text-bad">
      <span>{children}</span>
      {onRetry ? <button className="btn btn-small btn-danger" onClick={onRetry}>Try again</button> : null}
    </div>
  );
}

export function fmtRemaining(ms: number) {
  if (ms <= 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function Countdown({ until, className }: { until: number; className?: string }) {
  const now = useNow(1000);
  if (!now) return <span className={className}>…</span>;
  return <span className={`mono ${className ?? ""}`}>{fmtRemaining(until - now)}</span>;
}

export const fmtClock = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
export const fmtWhen = (secs: number) => new Date(secs * 1000).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
export const ago = (ms: number, now: number) => {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (!now || s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

// Minimal markdown: paragraphs, bullets, **bold**, [links](https://...). Never injects HTML.
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={i++}>{m[1]}</strong>);
    else out.push(<a key={i++} href={m[3]} target="_blank" rel="noopener noreferrer">{m[2]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
export function Markdown({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="md">
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
          return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*]\s+/, ""))}</li>)}</ul>;
        }
        const bullets = lines.findIndex((l) => /^\s*[-*]\s+/.test(l));
        if (bullets > 0) {
          return (
            <Fragment key={i}>
              <p>{inline(lines.slice(0, bullets).join(" "))}</p>
              <ul>{lines.slice(bullets).map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*]\s+/, ""))}</li>)}</ul>
            </Fragment>
          );
        }
        return <p key={i}>{inline(lines.join(" "))}</p>;
      })}
    </div>
  );
}
