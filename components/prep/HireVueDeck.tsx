"use client";
/**
 * HireVue practice deck on `/prep/[id]`. Each card is a likely question with a timer that runs your own method
 * (Jonno 2026-10-09: plan, then answer; notes on paper as a chain). Sky's real limits are unknown until the intro
 * screen, so the plan/answer lengths are set here and default short. The chain stays hidden until asked for, so a
 * run is practice from memory first, then a check. One timer runs at a time. Notes are cues to say in your own words.
 */
import { useEffect, useRef, useState } from "react";
import type { Question } from "@/lib/prep";

type Phase = "plan" | "answer" | "done";
const PLAN = [60, 120];
const ANSWER = [90, 120];
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;
const STATUS: Record<Question["status"], { glyph: string; label: string }> = {
  ready: { glyph: "●", label: "Ready" },
  partial: { glyph: "◐", label: "One gap for you" },
  gap: { glyph: "○", label: "No story yet" },
};

function Seg({ label, opts, value, onChange }: { label: string; opts: number[]; value: number; onChange: (n: number) => void }) {
  return (
    <div className="pp-seg" role="group" aria-label={label}>
      <span>{label}</span>
      {opts.map((n) => (
        <button key={n} type="button" aria-pressed={value === n} onClick={() => onChange(n)}>{mmss(n)}</button>
      ))}
    </div>
  );
}

export function HireVueDeck({ questions }: { questions: Question[] }) {
  const [plan, setPlan] = useState(PLAN[0]);
  const [answer, setAnswer] = useState(ANSWER[0]);
  const [run, setRun] = useState<{ i: number; phase: Phase; left: number } | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const end = useRef(0);

  useEffect(() => {
    if (!run || run.phase === "done") return;
    const id = setInterval(() => {
      const left = Math.ceil((end.current - Date.now()) / 1000);
      if (left > 0) return setRun((r) => (r ? { ...r, left } : r));
      if (run.phase === "plan") {
        end.current = Date.now() + answer * 1000;
        setRun({ i: run.i, phase: "answer", left: answer });
      } else setRun({ i: run.i, phase: "done", left: 0 });
    }, 250);
    return () => clearInterval(id);
  }, [run, answer]);

  const start = (i: number) => { end.current = Date.now() + plan * 1000; setRun({ i, phase: "plan", left: plan }); };
  const toggle = (i: number) => setOpen((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  return (
    <div className="pp-deck">
      <div className="pp-deck-ctl">
        <Seg label="Plan" opts={PLAN} value={plan} onChange={setPlan} />
        <Seg label="Answer" opts={ANSWER} value={answer} onChange={setAnswer} />
        <p>Real limits are on the HireVue intro screen. Practise at 1:30 so any limit is fine.</p>
      </div>
      <ol className="pp-qs">
        {questions.map((q, i) => {
          const live = run?.i === i ? run : null;
          const shown = open.has(i);
          return (
            <li key={q.q} className="pp-q" data-live={live ? live.phase : undefined}>
              <div className="pp-q-top">
                <span className="pp-q-n">{i + 1}</span>
                <div className="pp-q-main">
                  <h3>{q.q}</h3>
                  <p className="pp-q-meta">
                    <span className="pp-st" data-s={q.status}><i aria-hidden="true">{STATUS[q.status].glyph}</i>{STATUS[q.status].label}</span>
                    <span>{q.from}</span>
                    {q.value ? <span>Value: {q.value}</span> : null}
                  </p>
                </div>
                <div className="pp-q-act">
                  {live && live.phase !== "done" ? (
                    <>
                      <span className="pp-clock" aria-live="off"><small>{live.phase === "plan" ? "Plan" : "Answer"}</small>{mmss(live.left)}</span>
                      <button type="button" className="pp-btn" onClick={() => setRun(null)}>Stop</button>
                    </>
                  ) : (
                    <button type="button" className="pp-btn pp-btn--go" onClick={() => start(i)}>
                      {live ? "Again" : "Practise"}
                    </button>
                  )}
                </div>
              </div>
              {live?.phase === "done" ? <p className="pp-done">Time. Now check your chain below, and say the learning line out loud.</p> : null}
              <button type="button" className="pp-link" aria-expanded={shown} onClick={() => toggle(i)}>{shown ? "Hide my chain" : "Show my chain"}</button>
              {shown ? (
                <div className="pp-chain">
                  <ol>{q.chain.map((c) => <li key={c}>{c}</li>)}</ol>
                  <p className="pp-ev"><b>Evidence:</b> {q.evidence}</p>
                  {q.gap ? <p className="pp-gap"><b>Gap, yours to fill:</b> {q.gap}</p> : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
