"use client";
import { explorerAddress, formatUsd } from "@/lib/solana/cluster";
import type { PublicConfig, Receipt } from "@/lib/types";
import { ReceiptList } from "./Receipt";

export function Steps() {
  const steps = [
    ["1", "Set aside petty cash", "Pick a small amount and an expiry. It stays in your wallet. Solana records a limit, nothing more."],
    ["2", "The agent runs an errand", "It buys what it needs, a search, a page, some data, a fraction of a cent at a time, from real companies."],
    ["3", "Every receipt is checked", "A separate QuickNode Stream watches the chain. A receipt is stamped only when its numbers match the seller's quote."],
  ];
  return (
    <section aria-labelledby="how" className="mt-16">
      <h2 id="how" className="eyebrow">How it works</h2>
      <ol className="mt-4 grid gap-4 md:grid-cols-3">
        {steps.map(([n, h, t]) => (
          <li key={n} className="sheet p-5">
            <span className="mono text-3xl font-semibold text-accent">{n}</span>
            <h3 className="mt-2 text-lg font-semibold">{h}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted">{t}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Enforcement({ config }: { config: PublicConfig | null }) {
  const ceiling = config ? formatUsd(config.limits.perPurchaseMaxBase) : "a set amount";
  const ask = config ? formatUsd(config.limits.approvalThresholdBase) : "a set amount";
  return (
    <section aria-labelledby="stops" className="mt-16">
      <h2 id="stops" className="text-2xl font-semibold tracking-tight">What stops it from overspending</h2>
      <p className="mt-2 max-w-2xl text-muted">Two layers, kept apart on purpose. The first does not depend on us being honest or online.</p>
      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <div className="sheet border-2 !border-ink p-5">
          <div className="eyebrow text-accent">Enforced by Solana</div>
          <ul className="mt-3 space-y-3 text-sm leading-relaxed">
            <li><strong>The total limit.</strong> The agent&apos;s key can never pull more than what is left in the petty cash. The chain refuses it.</li>
            <li><strong>The expiry.</strong> After the time you chose, the agent can pull nothing.</li>
            <li><strong>Revoke.</strong> You can close it at any moment from your own wallet, with or without this site.</li>
          </ul>
          <p className="mt-3 text-xs text-muted">This is the audited Subscriptions and Allowances program. We did not write it and cannot change it.</p>
        </div>
        <div className="sheet p-5">
          <div className="eyebrow">Enforced by our server</div>
          <ul className="mt-3 space-y-3 text-sm leading-relaxed">
            <li><strong>A ceiling per purchase.</strong> Anything above {ceiling} is refused.</li>
            <li><strong>Approved sellers only.</strong> The agent can only buy from a short list.</li>
            <li><strong>It asks you first</strong> for anything above {ask}.</li>
          </ul>
          <p className="mt-3 text-xs text-muted">These are good habits, not guarantees. If our server were wrong, the Solana limit would still hold.</p>
        </div>
      </div>
    </section>
  );
}

export function Feed({ config, receipts, error }: { config: PublicConfig; receipts: Receipt[] | null; error: string | null }) {
  return (
    <section aria-labelledby="feed" className="mt-16">
      <h2 id="feed" className="text-2xl font-semibold tracking-tight">Recent receipts from the house petty cash</h2>
      <p className="mt-2 max-w-2xl text-muted">Real purchases by people trying it. Each is stamped only after the independent check.</p>
      <div className="mt-5 max-w-2xl"><ReceiptList receipts={receipts} error={error} cluster={config.cluster} empty="No receipts yet. Run an errand above and yours will be the first." /></div>
    </section>
  );
}

export function CheckItYourself({ config }: { config: PublicConfig }) {
  const items: [string, string, string][] = [
    ["The agent's key", config.agent, "See every payment the agent has made and that it holds only the price of one purchase at a time."],
    ["The allowance program", config.allowancesProgram, "The audited Solana program that enforces the limit. Anyone can read it; we cannot change it."],
  ];
  if (config.house) items.push(["The house petty cash", config.house.delegation, "The public demo budget. Its remaining amount and expiry are readable by anyone."]);
  return (
    <section aria-labelledby="check" className="mt-16">
      <h2 id="check" className="text-2xl font-semibold tracking-tight">Check it yourself</h2>
      <ul className="mt-4 max-w-2xl divide-y divide-dashed divide-rule border-y border-dashed border-rule">
        {items.map(([name, addr, why]) => (
          <li key={name} className="py-3 text-sm">
            <a className="font-semibold underline underline-offset-2" target="_blank" rel="noopener noreferrer" href={explorerAddress(addr, config.cluster)}>{name} on Solana Explorer ↗</a>
            <div className="mono break-all text-xs text-muted">{addr}</div>
            <p className="mt-1 text-muted">{why}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
