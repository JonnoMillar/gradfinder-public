"use client";
/**
 * Interview cards on /kit: the classic questions on the front, the points to hit on the back (facts from the store,
 * not a script). Click or Enter flips a card and turns any other open one back; "Show all answers" flips the lot. Cards still missing a story say so on
 * the front. The back shows STAR cue words (one trigger per step, to rebuild the answer out loud) or the full points:
 * the header switch sets every card, each card's own switch overrides it, and a card without cue lines always shows
 * its points. The back is a div, not a button, so its switch isn't nested in one: a full-size button under the
 * content flips it back. Data: profile/answers/interview-cards.md via lib/kit.ts.
 */
import { useState } from "react";
import type { KitCard } from "@/lib/kit";

const flipIcon = (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9L13.5 5.7" /><path d="M13.5 2.5v3.2h-3.2" /><path d="M13.5 8a5.5 5.5 0 0 1-9.4 3.9L2.5 10.3" /><path d="M2.5 13.5v-3.2h3.2" />
  </svg>
);

type View = "cues" | "detail";

function ViewSwitch({ view, onChange, label, className }: { view: View; onChange: (v: View) => void; label: string; className?: string }) {
  return (
    <div className={`seg${className ? ` ${className}` : ""}`} role="group" aria-label={label}>
      {([["cues", "Cue words"], ["detail", "Detail"]] as const).map(([v, text]) => (
        <button key={v} type="button" className={`seg-b kx-seg-b${view === v ? " seg-b--on" : ""}`} aria-pressed={view === v} onClick={() => onChange(v)}>
          {view === v ? <span className="seg-thumb" /> : null}{text}
        </button>
      ))}
    </div>
  );
}

function Card({ c, flipped, onFlip, view, onView }: { c: KitCard; flipped: boolean; onFlip: () => void; view: View; onView: (v: View) => void }) {
  const cues = view === "cues" && c.cues.length > 0;
  return (
    <div className="kx-card" data-flipped={flipped || undefined} data-type={c.type.toLowerCase()}>
      <div className="kx-card-in">
        <button type="button" className="kx-card-face kx-card-front" onClick={onFlip} inert={flipped} aria-label={`${c.question}. Show the answer`}>
          <span className="kx-card-type">{c.type}</span>
          <span className="kx-card-q">{c.question}</span>
          {c.story ? <span className="kx-card-story">{c.story}</span> : null}
          <span className="kx-card-foot">
            {c.status === "gap" ? <span className="kx-pill" data-tone="bad">No story yet</span>
              : c.status === "partial" ? <span className="kx-pill" data-tone="warn">Missing a detail</span> : <span />}
            <span className="kx-card-flip">{flipIcon} Answer</span>
          </span>
        </button>
        <div className="kx-card-face kx-card-back" inert={!flipped}>
          <button type="button" className="kx-card-hit" onClick={onFlip} aria-label={`Back to the question: ${c.question}`} />
          <span className="kx-card-q kx-card-q--small">{c.question}</span>
          {c.story ? <span className="kx-card-story kx-card-story--back">{c.story}</span> : null}
          {cues ? (
            <span className="kx-cues">
              {c.cues.map((q, i) => (
                <span key={i} className="kx-cue" data-step={q.step}>
                  <span className="kx-cue-l">{q.step}</span><span className="kx-cue-w">{q.word}</span>
                  {q.hint ? <span className="kx-cue-h">{q.hint}</span> : null}
                </span>
              ))}
            </span>
          ) : (
            <>
              <span className="kx-card-pts">{c.bullets.map((b, i) => <span key={i}>{b}</span>)}</span>
              {c.notes.map((n, i) => <span key={i} className="kx-card-note">{n}</span>)}
            </>
          )}
          {c.cues.length ? <ViewSwitch view={view} onChange={onView} label={`Answer view for: ${c.question}`} className="kx-card-seg" /> : null}
        </div>
      </div>
    </div>
  );
}

export function KitCards({ cards }: { cards: KitCard[] }) {
  const [flipped, setFlipped] = useState<Set<number>>(new Set());
  const [view, setView] = useState<View>("cues");
  const [own, setOwn] = useState<Record<string, View>>({}); // a card's own switch, cleared by the header one
  const allOpen = flipped.size === cards.length;
  // opening a card turns every other one back, so one answer is in view at a time ("Show all" still opens the lot)
  const flip = (i: number) => setFlipped((s) => { if (s.has(i)) { const n = new Set(s); n.delete(i); return n; } return new Set([i]); });
  if (!cards.length) return null;
  return (
    <section id="cards" className="kx-cards" aria-labelledby="cards-h">
      <header className="kx-sec-h">
        <h2 id="cards-h">Interview cards</h2>
        <p>The questions that come up most. Flip a card for the points to hit, then say them your own way.</p>
        <div className="kx-cards-ctl">
          <ViewSwitch view={view} onChange={(v) => { setView(v); setOwn({}); }} label="Answer view for every card" />
          <button type="button" className="kx-btn" onClick={() => setFlipped(allOpen ? new Set() : new Set(cards.map((_, i) => i)))}>
            {flipIcon} {allOpen ? "Hide all answers" : "Show all answers"}
          </button>
        </div>
      </header>
      <div className="kx-card-grid">
        {cards.map((c, i) => (
          <Card key={c.question} c={c} view={own[c.question] ?? view} onView={(v) => setOwn((o) => ({ ...o, [c.question]: v }))}
            flipped={flipped.has(i)} onFlip={() => flip(i)} />
        ))}
      </div>
    </section>
  );
}
