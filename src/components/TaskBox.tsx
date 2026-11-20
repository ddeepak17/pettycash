"use client";
import { useState } from "react";

export const SUGGESTIONS = [
  "What is the weather in Austin this weekend, and do I need a jacket?",
  "What is new with Solana today? Three bullets with sources.",
  "Find a well-reviewed taco place near UT Austin.",
];

export function TaskBox({ onRun, busy, label, note, disabled, disabledReason }: {
  onRun: (task: string) => void; busy: boolean; label: string; note?: string; disabled?: boolean; disabledReason?: string;
}) {
  const [task, setTask] = useState("");
  const submit = (t: string) => { const v = t.trim(); if (v && !busy && !disabled) onRun(v); };
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(task); }} className="space-y-3">
      <label htmlFor="task" className="eyebrow block">Give the agent an errand</label>
      <textarea
        id="task" className="field min-h-24 resize-y text-base" rows={3} maxLength={500} value={task}
        onChange={(e) => setTask(e.target.value)} placeholder="Ask anything the web can answer."
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(task); }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={busy || disabled || !task.trim()}>{busy ? "Running…" : label}</button>
        {note ? <span className="text-sm text-muted">{note}</span> : null}
        {disabled && disabledReason ? <span className="text-sm text-muted">{disabledReason}</span> : null}
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Suggested errands">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" className="chip" disabled={busy} onClick={() => { setTask(s); submit(s); }}>{s}</button>
        ))}
      </div>
    </form>
  );
}
