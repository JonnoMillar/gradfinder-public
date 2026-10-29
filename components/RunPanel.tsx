"use client";

/**
 * Apply / Research on the role page (lib/runs/runs.ts): the two buttons, the live state of a run, and the question
 * cards a run raises. While a run is queued or running the page refreshes itself every few seconds. Errors from the
 * server are shown verbatim. Jonno submits the employer's form himself: "Ready" only means it is filled.
 */
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { answerQuestionAction, cancelRunAction, openApplyBrowserAction, openLoginBrowserAction, requestRunAction } from "@/app/actions";

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

  const [staged, setStaged] = useState(false);
  const go = (kind: "apply" | "research", useOpenTab = false) => start(async () => {
    setErr(null);
    const r = await requestRunAction({ jobId, kind, useOpenTab });
    if (!r.ok) setErr(r.error);
    else { setStaged(false); router.refresh(); }
  });
  // Apply step 1: open the apply page in the gradfinder Chrome window; Jonno clicks through to the form himself.
  const stage = () => start(async () => {
    setErr(null);
    const r = await openApplyBrowserAction({ jobId });
    if (!r.ok) setErr(r.error);
    else setStaged(true);
  });
  const lastFailed = runs.find((r) => r.state === "failed" && !active(r.kind));

  return (
    <section className="rn" aria-label="Apply and research with Claude">
      <div className="rn-top">
        {staged && !active("apply") ? (
          <>
            <button type="button" className="btn btn--go" disabled={pending} onClick={() => go("apply", true)}
                    title="Claude fills the form in the tab you last used in the gradfinder window">
              Form is open: fill it
            </button>
            <button type="button" className="rn-x" disabled={pending} onClick={() => setStaged(false)}>Back</button>
          </>
        ) : (
          <button type="button" className="btn btn--go" disabled={pending || !!active("apply")} onClick={stage}
                  title="Opens the apply page in the gradfinder window so you can click through to the form">
            {active("apply") ? "Applying with Claude…" : "Apply with Claude"}
          </button>
        )}
        <button type="button" className="btn" disabled={pending || !!active("research")} onClick={() => go("research")}
                title="Sourced deep research on this role">
          {active("research") ? "Researching…" : "Research this role"}
        </button>
        {err ? <span className="tmsg" data-err="1" role="status">{err}</span> : null}
      </div>

      {staged && !active("apply") ? (
        <p className="rn-hint">
          The apply page is open in the gradfinder Chrome window (a separate window from your usual browser). Click through any
          entrance or login there until the first page of the form shows, then press "Form is open: fill it".
        </p>
      ) : live.length === 0 ? (
        <p className="rn-hint">
          Apply opens the role's page in the gradfinder Chrome window for you to reach the form; Claude then fills it in that same tab.
        </p>
      ) : null}

      {live.map((r) => (
        <div key={r.id} className="rn-run" data-state={r.state}>
          <span className="rn-chip">{r.kind === "apply" ? "Apply" : "Research"} · {LABEL[r.state]}</span>
          {r.state === "queued" || r.state === "running" ? (
            <span className="rn-load" role="progressbar" aria-label={r.state === "queued" ? "Waiting for its turn" : "Working"} />
          ) : null}
          {r.state === "queued" ? <span className="rn-note">Waiting to start. Only one run goes at a time; this can take a few minutes.</span> : null}
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
          <strong>Failed.</strong> The last {lastFailed.kind} run stopped: {lastFailed.error ?? "no reason recorded"}
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
