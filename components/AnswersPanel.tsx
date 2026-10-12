"use client";

/**
 * Drafted free-text answers for this role. Edit, save as draft, or approve exactly this text — only approved
 * answers ever reach a form. Submitted answers are read-only. Errors from the server are shown verbatim.
 */
import { useState, useTransition } from "react";
import { reviewAnswerAction } from "@/app/actions";

export interface AnswerView {
  id: number; question: string; text: string; status: "draft" | "approved" | "submitted";
  wordLimit: number | null; charLimit: number | null; gaps: string[]; sources: string[];
}

const words = (s: string) => (s.trim().match(/\S+/g) ?? []).length;

function Answer({ a, jobId }: { a: AnswerView; jobId: number }) {
  const [text, setText] = useState(a.text);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null);
  const n = words(text);
  const over = (a.wordLimit && n > a.wordLimit) || (a.charLimit && text.length > a.charLimit);
  const locked = a.status === "submitted";
  const run = (approve: boolean) => start(async () => {
    setMsg(null);
    const r = await reviewAnswerAction({ id: a.id, text, approve, jobId });
    setMsg(r.ok ? { text: approve ? "Approved: the form-filler can use this" : "Saved as draft", err: false } : { text: r.error, err: true });
  });

  return (
    <div className="ans">
      <div className="ans-q">
        <span>{a.question}</span>
        <span className="pill-status" data-s={a.status === "draft" ? undefined : "applied"}>{a.status}</span>
      </div>
      <textarea className="tta" rows={Math.min(14, Math.max(5, Math.ceil(text.length / 95)))} value={text}
                disabled={pending || locked} onChange={(e) => setText(e.target.value)} aria-label={a.question} />
      <div className="ans-meta">
        <span data-over={over ? "1" : undefined}>
          {n} words{a.wordLimit ? ` / ${a.wordLimit}` : ""}{a.charLimit ? ` · ${text.length} / ${a.charLimit} chars` : ""}
        </span>
        {a.gaps.length ? <span className="ans-gap">{a.gaps.length} gap{a.gaps.length > 1 ? "s" : ""} to fill: {a.gaps.join(" · ")}</span> : null}
      </div>
      {a.sources.length ? (
        <details className="ans-src"><summary>Sources ({a.sources.length})</summary>
          <ul>{a.sources.map((s) => <li key={s}>{/^https?:/.test(s) ? <a href={s} target="_blank" rel="noreferrer">{s}</a> : s}</li>)}</ul>
        </details>
      ) : null}
      {!locked ? (
        <div className="tsave">
          <button type="button" className="btn" disabled={pending} onClick={() => run(false)}>Save draft</button>
          <button type="button" className="btn btn--go" disabled={pending} onClick={() => run(true)}>Approve</button>
          {msg ? <span className="tmsg" data-err={msg.err ? "1" : undefined} role="status">{msg.text}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export function AnswersPanel({ jobId, answers }: { jobId: number; answers: AnswerView[] }) {
  const approved = answers.filter((a) => a.status !== "draft").length;
  return (
    <section className="tracker" aria-labelledby="answers-h">
      <h3 id="answers-h">Application answers <span className="cnt">{approved}/{answers.length} approved</span></h3>
      {answers.map((a) => <Answer key={a.id} a={a} jobId={jobId} />)}
    </section>
  );
}
