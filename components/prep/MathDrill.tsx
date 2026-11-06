"use client";
/**
 * Five-minute mental-maths warm-up for the reasoning test (`/prep/[id]`). Generic technique, not Sky's questions:
 * two-digit sums, times tables to 12, percentages, percentage change, ratio shares, exact division. Questions are
 * built on Start (never at render) so server and client never disagree. Integer answers only, so a typed number is
 * checked by equality. One at a time, Enter to submit; the result lists what you got wrong.
 */
import { useRef, useState } from "react";

interface Q { text: string; answer: number }
const rnd = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const pick = <T,>(xs: T[]) => xs[rnd(0, xs.length - 1)];

function make(): Q {
  switch (rnd(0, 6)) {
    case 0: { const a = rnd(23, 98), b = rnd(17, 89); return { text: `${a} + ${b}`, answer: a + b }; }
    case 1: { const a = rnd(61, 199), b = rnd(18, 59); return { text: `${a} − ${b}`, answer: a - b }; }
    case 2: { const a = rnd(6, 12), b = rnd(7, 19); return { text: `${a} × ${b}`, answer: a * b }; }
    case 3: { const p = pick([5, 10, 15, 20, 25, 30, 40, 60, 75]), n = rnd(2, 20) * 20; return { text: `${p}% of ${n}`, answer: (p * n) / 100 }; }
    case 4: { const p = pick([5, 10, 15, 20, 25]), n = rnd(2, 20) * 20; return { text: `${n} increased by ${p}%`, answer: n + (p * n) / 100 }; }
    case 5: { const a = rnd(2, 5), b = rnd(1, 4) + a, k = rnd(2, 12); return { text: `Split ${(a + b) * k} in the ratio ${a}:${b}. The larger share is…`, answer: b * k }; }
    default: { const b = rnd(4, 12), a = b * rnd(6, 15); return { text: `${a} ÷ ${b}`, answer: a / b }; }
  }
}

const N = 10;

export function MathDrill() {
  const [qs, setQs] = useState<Q[] | null>(null);
  const [i, setI] = useState(0);
  const [given, setGiven] = useState<string[]>([]);
  const [val, setVal] = useState("");
  const [took, setTook] = useState(0);
  const t0 = useRef(0);

  const begin = () => { setQs(Array.from({ length: N }, make)); setI(0); setGiven([]); setVal(""); t0.current = Date.now(); };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const g = [...given, val.trim()];
    setGiven(g); setVal("");
    if (g.length === N) setTook(Math.round((Date.now() - t0.current) / 1000));
    else setI(g.length);
  };

  if (!qs) {
    return (
      <div className="pp-drill">
        <p>Ten quick questions, no calculator. Aim to be warm, not tired. Accuracy first.</p>
        <button type="button" className="pp-btn pp-btn--go" onClick={begin}>Start the drill</button>
      </div>
    );
  }
  if (given.length === N) {
    const wrong = qs.map((q, k) => ({ q, g: given[k] })).filter(({ q, g }) => Number(g) !== q.answer || g === "");
    return (
      <div className="pp-drill">
        <p className="pp-drill-score"><b>{N - wrong.length}/{N}</b> in {took}s</p>
        {wrong.length ? (
          <ul>{wrong.map(({ q, g }) => <li key={q.text}>{q.text} = <b>{q.answer}</b> <span>(you said {g || "nothing"})</span></li>)}</ul>
        ) : <p>All correct.</p>}
        <button type="button" className="pp-btn pp-btn--go" onClick={begin}>Another ten</button>
      </div>
    );
  }
  return (
    <form className="pp-drill" onSubmit={submit}>
      <p className="pp-drill-n">{i + 1} of {N}</p>
      <label className="pp-drill-q" htmlFor="drill-a">{qs[i].text}</label>
      <div className="pp-drill-row">
        <input id="drill-a" inputMode="numeric" autoComplete="off" autoFocus value={val} onChange={(e) => setVal(e.target.value)} />
        <button type="submit" className="pp-btn pp-btn--go">Next</button>
      </div>
    </form>
  );
}
