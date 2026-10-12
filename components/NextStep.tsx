"use client";

/**
 * A role's next step, set and ticked off right on the Applications page. "Done" clears it (with Undo); the
 * role page's Tracker panel edits the same two fields. Errors are shown verbatim.
 *
 * With no step of his own, the stage's default shows instead (lib/tracker/steps.ts, marked "suggested"), so every live
 * application says what to do next. "Set my own" replaces it; the default is never saved.
 */
import { useState, useTransition } from "react";
import { setNextStep } from "@/app/actions";
import { daysUntil, fmtDate } from "@/lib/ui/format";
import { levelFor, whenLabel } from "@/lib/tracker/attention";
import { defaultStep } from "@/lib/tracker/steps";

export function NextStep({ jobId, text, due, status, appliedAt = null }: {
  jobId: number; text: string | null; due: string | null; status: string; appliedAt?: string | null;
}) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ text: text ?? "", due: due ?? "" });
  const [cleared, setCleared] = useState<{ text: string; due: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const save = (t: string | null, d: string | null, after?: () => void) =>
    start(async () => {
      setErr(null);
      const r = await setNextStep({ jobId, nextAction: t, nextActionDue: d });
      if (!r.ok) { setErr(r.error); return; }
      after?.();
    });

  if (editing) {
    return (
      <form
        className="ns ns--edit"
        onSubmit={(e) => { e.preventDefault(); save(draft.text.trim() || null, draft.due || null, () => setEditing(false)); }}
      >
        <input
          className="tin" autoFocus value={draft.text} maxLength={400} placeholder="What's the next step?"
          aria-label="Next step" onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
        />
        <input
          className="tin ns-date" type="date" value={draft.due} aria-label="Due"
          onChange={(e) => setDraft({ ...draft, due: e.target.value })}
        />
        <button className="btn btn--sm btn--go" disabled={pending}>Save</button>
        <button type="button" className="btn btn--sm" onClick={() => setEditing(false)}>Cancel</button>
        {err ? <span className="tmsg" data-err="1" role="status">{err}</span> : null}
      </form>
    );
  }

  if (!text) {
    const def = cleared ? null : defaultStep(status, appliedAt);
    return (
      <div className="ns" data-auto={def ? "1" : undefined}>
        {cleared ? (
          <span className="ns-done">
            Done: {cleared.text}
            <button type="button" className="ns-link" disabled={pending} onClick={() => save(cleared.text, cleared.due, () => setCleared(null))}>Undo</button>
          </span>
        ) : def ? (
          <>
            <span className="ns-k">Next</span>
            <span className="ns-t">{def.text}</span>
            {def.due ? <span className="ns-due" title={fmtDate(def.due)}>{whenLabel(daysUntil(def.due) ?? 0)}</span> : null}
            <span className="ns-auto">suggested</span>
            <span className="ns-acts">
              <button type="button" className="ns-link" onClick={() => { setDraft({ text: "", due: "" }); setEditing(true); }}>Set my own</button>
            </span>
          </>
        ) : (
          <button type="button" className="ns-add" onClick={() => { setDraft({ text: "", due: "" }); setEditing(true); }}>
            + Set a next step
          </button>
        )}
        {err ? <span className="tmsg" data-err="1" role="status">{err}</span> : null}
      </div>
    );
  }

  const d = daysUntil(due);
  return (
    <div className="ns" data-level={d === null ? undefined : levelFor(d)}>
      <span className="ns-k">Next</span>
      <span className="ns-t">{text}</span>
      {due ? <span className="ns-due" title={fmtDate(due)}>{d === null ? fmtDate(due) : whenLabel(d)}</span> : null}
      <span className="ns-acts">
        <button type="button" className="ns-link" disabled={pending}
          onClick={() => save(null, null, () => setCleared({ text, due }))}>Done</button>
        <button type="button" className="ns-link" onClick={() => { setDraft({ text, due: due ?? "" }); setEditing(true); }}>Edit</button>
      </span>
      {err ? <span className="tmsg" data-err="1" role="status">{err}</span> : null}
    </div>
  );
}
