"use client";

/**
 * In the graveyard, beside the graves: one rejected application at a time that is missing a rating, with two 1-5
 * questions (Jonno 2026-11-10): how much did you want it (sizes its headstone) and how much effort went in. Each one
 * has a Skip. A freshly buried one comes first, then the newest unrated. "Not now" hides the card until the page reloads.
 * It sits inside the panned world, below the climb, so it only shows in the graveyard view.
 */
import { useState } from "react";
import { Rate, type RateField } from "./Rate";

type Grave = { jobId: number; company: string; title: string; wantedEnd: number | null; effort: number | null };

export function GraveRate({ graves }: { graves: Grave[] }) {
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState(false);
  const done = (g: Grave, f: RateField) => answered.has(`${g.jobId}:${f}`) || (f === "wantedEnd" ? g.wantedEnd : g.effort) != null;
  const left = graves.filter((g) => !done(g, "wantedEnd") || !done(g, "effort"));
  const g = left[0];
  if (hidden || !g) return null;
  const mark = (f: RateField) => setAnswered((s) => new Set(s).add(`${g.jobId}:${f}`));
  return (
    <aside className="gy-rate" aria-label={`Rate the ${g.company} application`}>
      <p className="gy-rate-h"><b>{g.company}</b> <span>{g.title}</span></p>
      {!done(g, "wantedEnd") ? (
        <Rate key={`${g.jobId}w`} jobId={g.jobId} field="wantedEnd" question="How much did you want it?" low="A little" high="Badly" onDone={() => mark("wantedEnd")} />
      ) : null}
      {!done(g, "effort") ? (
        <Rate key={`${g.jobId}e`} jobId={g.jobId} field="effort" question="How much effort went in?" low="Minimal" high="All in" onDone={() => mark("effort")} />
      ) : null}
      <p className="gy-rate-foot">
        {left.length > 1 ? <span>{left.length - 1} more to rate</span> : <span />}
        <button type="button" className="gy-rate-later" onClick={() => setHidden(true)}>Not now</button>
      </p>
    </aside>
  );
}
