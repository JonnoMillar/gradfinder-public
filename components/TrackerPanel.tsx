"use client";

/**
 * Notes and the stage history for one role, at the foot of the role page. The next step has its own editor at the top
 * of the page (NextStep), so this saves notes only and can never overwrite a step edited there (2026-09-29).
 * Errors from server actions are shown verbatim — the UI never swallows a failure (spec §7).
 */
import { useState, useTransition } from "react";
import { APPLICATION_STATUS_LABEL, fmtDateTime } from "@/lib/ui/format";
import { saveNotes, type ActionResult } from "@/app/actions";

type Activity = { from_status: string | null; to_status: string; note: string | null; at: string };

export function TrackerPanel({ jobId, status, notes, activity, emails }: {
  jobId: number;
  status: string | null;
  notes: string | null;
  activity: Activity[];
  emails: { id: number; receivedAt: string; subject: string; viewUrl: string | null }[];
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null);
  const [note, setNote] = useState(notes ?? "");
  const current = status ?? "discovered";

  const run = (fn: () => Promise<ActionResult>, okText: string) =>
    start(async () => {
      setMsg(null);
      const r = await fn();
      setMsg(r.ok ? { text: okText, err: false } : { text: r.error, err: true });
    });

  return (
    <section className="tracker" aria-labelledby="tracker-h">
      <h3 id="tracker-h">Tracker</h3>

      <p className="nf">Status: <b>{APPLICATION_STATUS_LABEL[current] ?? current}</b> · the stage and the next step are at the top of the page.</p>

      <div className="tfield">
        <label htmlFor="nt">Notes</label>
        <textarea id="nt" className="tta" rows={4} value={note} disabled={pending}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Anything worth remembering before you apply." />
      </div>

      <div className="tsave">
        <button
          type="button" className="btn btn--go" disabled={pending}
          onClick={() => run(
            () => saveNotes({ jobId, notes: note.trim() || null }),
            "Saved",
          )}
        >
          {pending ? "Saving…" : "Save notes"}
        </button>
        {msg ? <span className="tmsg" data-err={msg.err ? "1" : undefined} role="status">{msg.text}</span> : null}
      </div>

      {emails.length ? (
        <ul className="log">
          {emails.map((e) => (
            <li key={e.id}>
              <span className="when">{fmtDateTime(e.receivedAt)}</span>
              <span>
                {e.subject}
                {e.viewUrl ? <> · <a href={e.viewUrl} target="_blank" rel="noreferrer" className="link-mint">Open email</a></> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {activity.length ? (
        <ul className="log">
          {activity.map((a, i) => (
            <li key={i}>
              <span className="when">{fmtDateTime(a.at)}</span>
              <span>
                {a.from_status
                  ? `${APPLICATION_STATUS_LABEL[a.from_status] ?? a.from_status} → `
                  : ""}
                <b>{APPLICATION_STATUS_LABEL[a.to_status] ?? a.to_status}</b>
                {a.note ? ` · ${a.note}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
