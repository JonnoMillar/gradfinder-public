"use client";

/**
 * Apply / Research on the role page (lib/runs/runs.ts): the two buttons, the live state of a run, and the question
 * cards a run raises. While a run is queued or running the page refreshes itself every few seconds. Errors from the
 * server are shown verbatim. Jonno submits the employer's form himself: "Ready" only means it is filled.
 */
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { answerQuestionAction, cancelRunAction, openLoginBrowserAction, requestRunAction } from "@/app/actions";

export interface RunView { id: number; kind: "apply" | "research"; state: string; note: string | null; error: string | null; formUrl: string | null; costUsd: number }
export interface QuestionView { id: number; runId: number; kind: string; prompt: string; options: string[] | null; standing: boolean }

const LIVE = new Set(["queued", "running", "needs_you", "ready"]);
const LABEL: Record<string, string> = {
  queued: "Queued", running: "Working", needs_you: "Needs you", ready: "Ready for you", done: "Done", failed: "Failed", cancelled: "Cancelled",
};

function Card({ q, jobId }: { q: QuestionView; jobId: number }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const send = (answer: string) => start(async () => {
    setErr(null);
    const r = await answerQuestionAction({ questionId: q.id, answer, jobId });
    if (!r.ok) setErr(r.error);
  });
  const url = q.prompt.match(/https:\/\/\S+/)?.[0];
  return (
    <div className="rn-card" data-kind={q.kind}>
      <p className="rn-q">{q.prompt}</p>
      {q.kind === "review" ? (
        <p className="rn-hint">Edit and approve the drafted answers in the Application answers section below, then confirm.</p>
      ) : null}
      {q.kind === "login" && url ? (
        <button type="button" className="btn" disabled={pending} onClick={() => start(async () => {
          const r = await openLoginBrowserAction({ url });
          if (!r.ok) setErr(r.error);
        })}>Open the browser to log in</button>
      ) : null}
      {q.options?.length ? (
        <div className="rn-opts">
          {q.options.map((o) => <button key={o} type="button" className="btn" disabled={pending} onClick={() => send(o)}>{o}</button>)}
        </div>
      ) : (
        <div className="rn-row">
          <input className="tin" value={text} onChange={(e) => setText(e.target.value)} aria-label={q.prompt} disabled={pending}
                 placeholder={q.kind === "login" ? "Type done when you are logged in" : "Your answer"} />
          <button type="button" className="btn btn--go" disabled={pending || !text.trim()} onClick={() => send(text)}>Answer</button>
        </div>
      )}
      {q.standing ? <p className="rn-hint">Saved for every future application.</p> : null}
      {err ? <span className="tmsg" data-err="1" role="status">{err}</span> : null}
    </div>
  );
}

export function RunPanel({ jobId, runs, questions }: { jobId: number; runs: RunView[]; questions: QuestionView[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const live = runs.filter((r) => LIVE.has(r.state));
  const active = (k: RunView["kind"]) => live.find((r) => r.kind === k);
  const watching = live.some((r) => r.state === "queued" || r.state === "running");

  useEffect(() => {
    if (!watching) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [watching, router]);

  const go = (kind: "apply" | "research") => start(async () => {
    setErr(null);
    const r = await requestRunAction({ jobId, kind });
    if (!r.ok) setErr(r.error);
    else router.refresh();
  });
  const lastFailed = runs.find((r) => r.state === "failed" && !active(r.kind));

  return (
    <section className="rn" aria-label="Apply and research with Claude">
      <div className="rn-top">
        <button type="button" className="btn btn--go" disabled={pending || !!active("apply")} onClick={() => go("apply")}
                title="Claude fills the form in the background and asks you only for what it can't answer">
          {active("apply") ? "Applying with Claude…" : "Apply with Claude"}
        </button>
        <button type="button" className="btn" disabled={pending || !!active("research")} onClick={() => go("research")}
                title="Sourced deep research on this role">
          {active("research") ? "Researching…" : "Research this role"}
        </button>
        {err ? <span className="tmsg" data-err="1" role="status">{err}</span> : null}
      </div>

      {live.map((r) => (
        <div key={r.id} className="rn-run" data-state={r.state}>
          <span className="rn-chip">{r.kind === "apply" ? "Apply" : "Research"} · {LABEL[r.state]}</span>
          {r.costUsd > 0 ? <span className="rn-note" title="Subscription usage so far, priced at API rates (not a bill)">≈ ${r.costUsd.toFixed(2)} usage</span> : null}
          <span className="rn-note">{r.note ?? ""}</span>
          {r.state === "ready" && r.kind === "apply" ? (
            <span className="rn-note">The filled form is open in the gradfinder browser window. Check it and press Submit there.</span>
          ) : null}
          {r.state === "ready" && r.formUrl ? <a className="btn" href={r.formUrl} target="_blank" rel="noreferrer" title="Only useful when the employer saves as you go (tal.net); a single-page form opens empty">Open the form in your own browser</a> : null}
          <button type="button" className="rn-x" disabled={pending} title={r.state === "ready" ? "Closes the form window without submitting" : undefined}
                  onClick={() => start(async () => {
            const c = await cancelRunAction({ runId: r.id, jobId });
            if (!c.ok) setErr(c.error);
            else router.refresh();
          })}>{r.state === "ready" ? "Discard" : "Cancel"}</button>
        </div>
      ))}

      {lastFailed ? (
        <p className="rn-fail" role="status">
          The last {lastFailed.kind} run failed: {lastFailed.error ?? "no reason recorded"}
        </p>
      ) : null}

      {questions.length ? (
        <div className="rn-cards">
          <h4>Needs you <span className="cnt">{questions.length}</span></h4>
          {questions.map((q) => <Card key={q.id} q={q} jobId={jobId} />)}
        </div>
      ) : null}
    </section>
  );
}
