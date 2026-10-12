"use client";

/**
 * The status toggle on the Applications page: six stages on a line, one click to move a role to any of them, plus
 * Closed / Rejected / Dismiss off the line. Every move offers Undo for a few seconds, because a click here writes Jonno's
 * real tracker and a stray one should cost nothing. Undo is just a move back (it logs its own activity entry).
 *
 * The Undo toast lives once on the page (<UndoToast/>), not in the row: a move usually sends the row to another
 * group, which remounts it, and a toast inside it would vanish with the old row.
 */
import { useEffect, useOptimistic, useState, useSyncExternalStore, useTransition } from "react";
import { APPLICATION_STATUS_LABEL } from "@/lib/ui/format";
import { dismiss, setStatus, type ActionResult } from "@/app/actions";
import { emitMoved } from "./motion";

const UNDO_MS = 10_000;

/**
 * Six steps on the line (Jonno 2026-10-09). A step with a `todo` status starts highlighted when you reach it ("Applying",
 * "Tests", "HireVue": your move) and clicking it again ticks it (`done`: "Applied", "Tests sat", ...: their move).
 * `label` is what a step not yet reached says.
 */
const STEPS = [
  { key: "interested", label: "Interested", todo: null, done: "interested", todoLabel: "", doneLabel: "Interested" },
  { key: "applying", label: "Applied", todo: "applying", done: "applied", todoLabel: "Applying", doneLabel: "Applied" },
  { key: "tests", label: "Tests", todo: "tests", done: "tests_done", todoLabel: "Tests", doneLabel: "Tests sat" },
  { key: "hirevue", label: "HireVue", todo: "hirevue", done: "hirevue_done", todoLabel: "HireVue", doneLabel: "HireVue done" },
  { key: "interview", label: "Interview", todo: "interview", done: "interview_done", todoLabel: "Interview", doneLabel: "Interviewed" },
  { key: "offer", label: "Offer", todo: null, done: "offer", todoLabel: "", doneLabel: "Offer" },
] as const;
type StepDef = (typeof STEPS)[number];

/** Where a status sits on the line: the step and whether it is still to do or ticked. */
function place(status: string): { at: number; ticked: boolean } {
  const at = STEPS.findIndex((s) => s.todo === status || s.done === status);
  return { at, ticked: at >= 0 && STEPS[at].done === status };
}

/** Clicking a step: reach it (highlighted, to do), tick it when it is the current one, untick a ticked current one. */
function target(s: StepDef, i: number, at: number, ticked: boolean): string {
  if (i !== at) return i < at || !s.todo ? s.done : s.todo;
  if (!s.todo) return s.done;
  return ticked ? s.todo : s.done;
}

/** Off the line: the three ways a role ends. Each one archives it on the Applications page. */
const OFF = [
  ["closed", "Closed", "The employer closed applications: the role can't be got. Archives it and hides it from Roles."],
  ["rejected", "Rejected", "They turned you down"],
  ["dismissed", "Dismiss", "Not for you"],
] as const;

function write(jobId: number, to: string): Promise<ActionResult> {
  return to === "dismissed" ? dismiss({ jobId, reason: null }) : setStatus({ jobId, status: to });
}

// ------------------------------------------------------------------ the one pending undo, shared by every row
type Undo = { jobId: number; company: string; from: string; to: string; n: number };
let current: Undo | null = null;
let seq = 0;
const subs = new Set<() => void>();
const emit = (u: Undo | null) => { current = u; subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** Offer Undo for a move made elsewhere (the Not interested bin on a role tile or the Up next card). */
export function offerUndo(u: Omit<Undo, "n">) { emit({ ...u, n: ++seq }); }
/** Fired after an Undo lands, so a tile hidden by the bin can come back before the server re-render does. */
export const UNDONE_EVENT = "gf:undone";

export function UndoToast() {
  const u = useSyncExternalStore(subscribe, () => current, () => null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!u) return;
    const t = setTimeout(() => { if (current?.n === u.n) emit(null); }, UNDO_MS);
    return () => clearTimeout(t);
  }, [u]);

  if (!u && !err) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      {u ? (
        <>
          <span>
            {u.to === "dismissed"
              ? <><b>{u.company}</b> binned: not interested</>
              : <><b>{u.company}</b> moved to {APPLICATION_STATUS_LABEL[u.to]}</>}
          </span>
          <button type="button" disabled={pending} onClick={() => start(async () => {
            const r = await write(u.jobId, u.from);
            emit(null);
            setErr(r.ok ? null : r.error);
            if (r.ok) window.dispatchEvent(new CustomEvent(UNDONE_EVENT, { detail: u.jobId }));
          })}>
            Undo
          </button>
        </>
      ) : (
        <>
          <span data-err="1">Undo failed: {err}</span>
          <button type="button" onClick={() => setErr(null)}>Close</button>
        </>
      )}
    </div>
  );
}

export function StageTrack({ jobId, status, company }: { jobId: number; status: string; company: string }) {
  const [pending, start] = useTransition();
  const [shown, setShown] = useOptimistic(status);
  const [err, setErr] = useState<string | null>(null);

  const move = (to: string) => {
    if (to === shown) return;
    const from = shown;
    start(async () => {
      setErr(null);
      setShown(to);
      const r = await write(jobId, to);
      if (!r.ok) { setErr(r.error); return; }
      emit({ jobId, company, from, to, n: ++seq });
      emitMoved({ jobId, company, from, to });
    });
  };

  const { at, ticked } = place(shown);

  return (
    <div className="trk" aria-busy={pending}>
      <ol className="trk-line" aria-label={`${company}: stage`}>
        {STEPS.map((s, i) => {
          const state = at < 0 || i > at ? "next" : i < at ? "past" : s.todo && !ticked ? "todo" : "on";
          const to = target(s, i, at, ticked);
          const label = state === "next" ? s.label : state === "todo" ? s.todoLabel : s.doneLabel;
          const hint = state === "todo" ? `Your move. Click when it's done: ${s.doneLabel}`
            : state === "on" && s.todo ? `Done. Click to undo the tick: back to ${s.todoLabel}`
            : `Move to ${APPLICATION_STATUS_LABEL[to]}`;
          return (
            <li key={s.key} data-s={s.key} data-state={state}>
              <button
                type="button" className="trk-node" disabled={pending}
                aria-pressed={i === at} title={hint} aria-label={`${label}: ${hint}`}
                onClick={() => move(to)}
              >
                <span className="trk-dot" aria-hidden="true">
                  <svg viewBox="0 0 12 12" width="9" height="9"><path d="M2.5 6.2 5 8.6l4.6-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
                <span className="trk-lab">{label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="trk-off">
        {OFF.map(([s, label, title]) => (
          <button
            key={s} type="button" disabled={pending} data-s={s} title={title}
            className="trk-x" aria-pressed={shown === s}
            onClick={() => move(s)}
          >
            {label}
          </button>
        ))}
      </div>
      {err ? <span className="tmsg" data-err="1" role="status">{err}</span> : null}
    </div>
  );
}
