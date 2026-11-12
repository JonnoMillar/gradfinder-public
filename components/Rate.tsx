"use client";

/**
 * One 1-5 question with a Skip (Jonno 2026-11-10: "5 options ... must be a skip option"). Used when a role is sent
 * (StageTrack: how much do you want it) and on a fresh grave (GraveRate: how much did you want it, how much effort).
 * Five numbered squares between two end words; the picked one fills in (lightness, never hue). Writes at once through
 * `rateApplication`; 0 means skipped, so the question doesn't come back.
 */
import { useState, useTransition } from "react";
import { rateApplication } from "@/app/actions";

export type RateField = "wantedSent" | "wantedEnd" | "effort";

export function Rate({ jobId, field, question, low, high, onDone }: {
  jobId: number; field: RateField; question: string; low: string; high: string;
  /** called after the write lands (the parent may hide the question) */
  onDone?: (value: number) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const pick = (value: number) => start(async () => {
    setErr(null);
    setPicked(value);
    const r = await rateApplication({ jobId, field, value });
    if (!r.ok) { setErr(r.error); setPicked(null); return; }
    onDone?.(value);
  });
  return (
    <div className="rate" role="group" aria-label={question} aria-busy={pending}>
      <span className="rate-q">{question}</span>
      <span className="rate-row">
        <span className="rate-end">{low}</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" className="rate-n" disabled={pending} aria-pressed={picked === n}
                  aria-label={`${n} of 5${n === 1 ? `, ${low}` : n === 5 ? `, ${high}` : ""}`} onClick={() => pick(n)}>{n}</button>
        ))}
        <span className="rate-end">{high}</span>
        <button type="button" className="rate-skip" disabled={pending} aria-pressed={picked === 0} onClick={() => pick(0)}>Skip</button>
      </span>
      {err ? <span className="tmsg" data-err="1" role="status">{err}</span> : null}
    </div>
  );
}
