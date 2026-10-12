/**
 * Apply / Research runs and the questions they raise (tables `agent_runs`, `run_questions`).
 * Spec: docs/superpowers/specs/2026-09-30-one-click-apply-and-research-runner.md
 *
 *   queued ──(runner claims)──▶ running ──▶ needs_you ──(last question answered)──▶ queued …
 *                                   │
 *                                   ├──▶ ready (form filled, Jonno reviews and submits) ──▶ done
 *                                   └──▶ failed | cancelled
 *
 * The employer's form is the real state, so a re-queued run just re-reads it. One run at a time (one browser profile).
 * Layer 3: only the app's server actions, the runner and `npm run runq` write here.
 */
import { z } from "zod";
import { getSqlite } from "@/lib/db/client";
import { automationStatus } from "@/lib/tracker/email";
import { ACTIVE_RUN_STATES, QUESTION_KINDS, RUN_KINDS, type QuestionKind, type RunKind, type RunState } from "@/lib/db/schema";

export const STALE_MS = 10 * 60_000;
export const CAP_MS = 30 * 60_000;
/** How long the run browser stays open for an answered/filled form (needs_you, ready) before the window is closed. */
export const WINDOW_MS = 2 * 60 * 60_000;
const MAX_ATTEMPTS = 6;

export interface RunRow {
  id: number; kind: RunKind; jobId: number; applicationId: number | null; state: RunState; formUrl: string | null;
  note: string | null; error: string | null; attempts: number; heartbeatAt: string | null; startedAt: string | null;
  finishedAt: string | null; createdAt: string;
}
export interface QuestionRow {
  id: number; runId: number; kind: QuestionKind; prompt: string; options: string[] | null; standing: boolean;
  factKey: string | null; answer: string | null; answeredAt: string | null;
}

const toRun = (r: Record<string, unknown>): RunRow => ({
  id: Number(r.id), kind: r.kind as RunKind, jobId: Number(r.job_id),
  applicationId: r.application_id == null ? null : Number(r.application_id), state: r.state as RunState,
  formUrl: (r.form_url as string) ?? null, note: (r.note as string) ?? null, error: (r.error as string) ?? null,
  attempts: Number(r.attempts), heartbeatAt: (r.heartbeat_at as string) ?? null, startedAt: (r.started_at as string) ?? null,
  finishedAt: (r.finished_at as string) ?? null, createdAt: String(r.created_at),
});
const toQuestion = (r: Record<string, unknown>): QuestionRow => ({
  id: Number(r.id), runId: Number(r.run_id), kind: r.kind as QuestionKind, prompt: String(r.prompt),
  options: r.options ? (JSON.parse(String(r.options)) as string[]) : null, standing: Boolean(r.standing),
  factKey: (r.fact_key as string) ?? null, answer: (r.answer as string) ?? null, answeredAt: (r.answered_at as string) ?? null,
});

export const getRun = (id: number): RunRow | null => {
  const r = getSqlite().prepare("select * from agent_runs where id = ?").get(id);
  return r ? toRun(r as Record<string, unknown>) : null;
};

/** The one live run for this role and kind, if any. */
export function activeRun(jobId: number, kind: RunKind): RunRow | null {
  const r = getSqlite().prepare(`select * from agent_runs where job_id = ? and kind = ? and state in (${ACTIVE_RUN_STATES.map(() => "?").join(",")})`)
    .get(jobId, kind, ...ACTIVE_RUN_STATES);
  return r ? toRun(r as Record<string, unknown>) : null;
}

/** Latest run of any state for a role: what the role page shows. */
export function latestRuns(jobId: number): RunRow[] {
  return (getSqlite().prepare("select * from agent_runs where job_id = ? order by id desc limit 6").all(jobId) as Record<string, unknown>[]).map(toRun);
}

export function openQuestions(runId: number): QuestionRow[] {
  return (getSqlite().prepare("select * from run_questions where run_id = ? and answer is null order by id").all(runId) as Record<string, unknown>[]).map(toQuestion);
}
export function allQuestions(runId: number): QuestionRow[] {
  return (getSqlite().prepare("select * from run_questions where run_id = ? order by id").all(runId) as Record<string, unknown>[]).map(toQuestion);
}

/** Every run waiting on Jonno, with its open questions: the "Needs you" inbox. */
export function needsYou(): { run: RunRow; company: string; title: string; questions: QuestionRow[] }[] {
  const rows = getSqlite().prepare(`
    select r.*, c.name as company, j.title as title from agent_runs r
    join jobs j on j.id = r.job_id join companies c on c.id = j.company_id
    where r.state = 'needs_you' order by r.id`).all() as Record<string, unknown>[];
  return rows.map((r) => ({ run: toRun(r), company: String(r.company), title: String(r.title), questions: openQuestions(Number(r.id)) }));
}

export type RequestResult = { runId: number; created: boolean; state: RunState };

/** Jonno pressed Apply or Research. An existing live run is returned, never duplicated. */
export function requestRun(jobId: number, kind: RunKind, now = new Date().toISOString()): RequestResult {
  if (!RUN_KINDS.includes(kind)) throw new Error(`Unknown run kind ${kind}`);
  const db = getSqlite();
  const job = db.prepare("select id, is_active from jobs where id = ?").get(jobId) as { id: number; is_active: number } | undefined;
  if (!job) throw new Error(`No job ${jobId}`);
  const live = activeRun(jobId, kind);
  if (live) return { runId: live.id, created: false, state: live.state };
  let applicationId: number | null = null;
  if (kind === "apply") {
    const st = automationStatus(jobId, "applying", "Apply run requested", now) as { applicationId?: number };
    applicationId = st.applicationId ?? (db.prepare("select id from applications where job_id = ?").get(jobId) as { id: number } | undefined)?.id ?? null;
  }
  const info = db.prepare("insert into agent_runs (kind, job_id, application_id, state, note, created_at) values (?,?,?,?,?,?)")
    .run(kind, jobId, applicationId, "queued", "Waiting for the runner", now);
  return { runId: Number(info.lastInsertRowid), created: true, state: "queued" };
}

/**
 * The runner takes the oldest queued run, but only if nothing is running (one browser profile).
 * Returns null when there is nothing to do.
 */
export function claimNext(now = new Date().toISOString(), kinds: readonly RunKind[] = RUN_KINDS): RunRow | null {
  const db = getSqlite();
  return db.transaction(() => {
    if (db.prepare("select 1 from agent_runs where state = 'running'").get()) return null;
    const next = db.prepare(`select * from agent_runs where state = 'queued' and kind in (${kinds.map(() => "?").join(",")}) order by id limit 1`)
      .get(...kinds) as Record<string, unknown> | undefined;
    if (!next) return null;
    // started_at = this pass: the 30-minute cap is per pass (a resume hours later must not inherit the first pass's clock).
    db.prepare("update agent_runs set state='running', attempts=attempts+1, started_at=?, heartbeat_at=?, note=?, error=null where id=?")
      .run(now, now, "Started", next.id);
    return getRun(Number(next.id));
  })();
}

/**
 * The run browser (lib/runs/browser.ts) holds a filled single-page form that only exists in its window. While an apply
 * run is `ready`, another apply run must not start (it would drive the same window), so the runner claims research only.
 */
export function readyApplyRun(): RunRow | null {
  const r = getSqlite().prepare("select * from agent_runs where kind = 'apply' and state = 'ready' order by id limit 1").get();
  return r ? toRun(r as Record<string, unknown>) : null;
}

/** Should the run browser be open now? Yes while an apply run is working, queued, or waiting/ready within WINDOW_MS. */
export function browserWanted(now = Date.now()): boolean {
  const rows = getSqlite().prepare("select state, heartbeat_at, created_at from agent_runs where kind = 'apply' and state in ('queued','running','needs_you','ready')").all() as
    { state: string; heartbeat_at: string | null; created_at: string }[];
  return rows.some((r) => r.state === "queued" || r.state === "running" || now - new Date(r.heartbeat_at ?? r.created_at).getTime() < WINDOW_MS);
}

export function heartbeat(runId: number, note?: string, now = new Date().toISOString()) {
  getSqlite().prepare("update agent_runs set heartbeat_at = ?, note = coalesce(?, note) where id = ? and state = 'running'").run(now, note ?? null, runId);
}

export const AskInput = z.object({
  kind: z.enum(QUESTION_KINDS),
  prompt: z.string().trim().min(3).max(2000),
  options: z.array(z.string().trim().min(1)).max(40).nullish(),
  standing: z.boolean().default(false),
  factKey: z.string().trim().min(1).max(120).nullish(),
});

/** The agent hit gaps. All of them go in together; the run waits for Jonno. */
export function ask(runId: number, raw: unknown, now = new Date().toISOString()): number {
  const items = z.array(AskInput).min(1).parse(raw);
  const db = getSqlite();
  const run = getRun(runId);
  if (!run) throw new Error(`No run ${runId}`);
  if (run.state !== "running") throw new Error(`Run ${runId} is ${run.state}, not running`);
  db.transaction(() => {
    const ins = db.prepare("insert into run_questions (run_id, kind, prompt, options, standing, fact_key, created_at) values (?,?,?,?,?,?,?)");
    for (const q of items) {
      // The same open prompt is never asked twice on one run.
      if (db.prepare("select 1 from run_questions where run_id = ? and prompt = ? and answer is null").get(runId, q.prompt)) continue;
      ins.run(runId, q.kind, q.prompt, q.options?.length ? JSON.stringify(q.options) : null, q.standing ? 1 : 0, q.factKey ?? null, now);
    }
    db.prepare("update agent_runs set state='needs_you', heartbeat_at=?, note=? where id=?").run(now, `${items.length} question(s) for you`, runId);
  })();
  return items.length;
}

export type AnswerResult = { runId: number; requeued: boolean; remaining: number };

/** Jonno answered a card. When the last open one is answered the run goes back to the queue. */
export function answer(questionId: number, text: string, now = new Date().toISOString()): AnswerResult {
  const db = getSqlite();
  const q = db.prepare("select * from run_questions where id = ?").get(questionId) as Record<string, unknown> | undefined;
  if (!q) throw new Error(`No question ${questionId}`);
  const t = text.trim();
  if (!t) throw new Error("An answer can't be empty");
  const opts = q.options ? (JSON.parse(String(q.options)) as string[]) : null;
  if (opts && !opts.includes(t)) throw new Error("Pick one of the offered options");
  const runId = Number(q.run_id);
  return db.transaction(() => {
    db.prepare("update run_questions set answer = ?, answered_at = ? where id = ?").run(t, now, questionId);
    const remaining = (db.prepare("select count(*) as n from run_questions where run_id = ? and answer is null").get(runId) as { n: number }).n;
    let requeued = false;
    if (remaining === 0) {
      const r = db.prepare("update agent_runs set state='queued', note='Answers in, waiting for the runner' where id = ? and state = 'needs_you'").run(runId);
      requeued = r.changes > 0;
    }
    return { runId, requeued, remaining };
  })();
}

/** The form is filled as far as it can be; Jonno reviews and submits. Stores the employer's own form and role title. */
export function markReady(runId: number, opts: { note?: string; formUrl?: string; employerTitle?: string }, now = new Date().toISOString()) {
  const db = getSqlite();
  const run = getRun(runId);
  if (!run) throw new Error(`No run ${runId}`);
  if (run.state !== "running") throw new Error(`Run ${runId} is ${run.state}, not running`);
  db.prepare("update agent_runs set state='ready', form_url=coalesce(?, form_url), note=?, heartbeat_at=? where id=?")
    .run(opts.formUrl ?? null, opts.note ?? "Filled. Check it and submit", now, runId);
  if (run.applicationId && (opts.formUrl || opts.employerTitle)) {
    db.prepare("update applications set form_url=coalesce(?, form_url), employer_title=coalesce(?, employer_title), updated_at=? where id=?")
      .run(opts.formUrl ?? null, opts.employerTitle ?? null, now, run.applicationId);
  }
}

export function finish(runId: number, note?: string, now = new Date().toISOString()) {
  getSqlite().prepare("update agent_runs set state='done', finished_at=?, note=coalesce(?, note) where id=? and state in ('running','ready')").run(now, note ?? null, runId);
}
export function fail(runId: number, error: string, now = new Date().toISOString()) {
  getSqlite().prepare("update agent_runs set state='failed', finished_at=?, error=? where id=? and state in ('queued','running','needs_you')").run(now, error.slice(0, 500), runId);
}
export function cancel(runId: number, now = new Date().toISOString(), note = "Cancelled"): boolean {
  return getSqlite().prepare("update agent_runs set state='cancelled', finished_at=?, note=? where id=? and state in ('queued','running','needs_you','ready')").run(now, note, runId).changes > 0;
}

/**
 * Housekeeping, safe to call often: running runs with no heartbeat for 10 minutes (or past the 30-minute cap) fail;
 * a run that keeps failing to finish stops after MAX_ATTEMPTS; a ready apply run whose application has moved on to
 * applied or later is done; a ready apply run older than WINDOW_MS is cancelled.
 */
export function reap(now = new Date()): { failed: number; done: number } {
  const db = getSqlite();
  let failed = 0;
  for (const r of db.prepare("select * from agent_runs where state = 'running'").all() as Record<string, unknown>[]) {
    const beat = new Date(String(r.heartbeat_at ?? r.started_at ?? r.created_at)).getTime();
    const start = new Date(String(r.started_at ?? r.created_at)).getTime();
    const stale = now.getTime() - beat > STALE_MS;
    const capped = now.getTime() - start > CAP_MS;
    if (stale || capped) {
      fail(Number(r.id), stale ? "No heartbeat for 10 minutes" : "Hit the 30-minute cap", now.toISOString());
      failed++;
    }
  }
  const done = db.prepare(`
    update agent_runs set state='done', finished_at=?, note='Submitted'
    where state = 'ready' and kind = 'apply' and application_id in
      (select id from applications where status in ('applied','tests','tests_done','hirevue','hirevue_done','interview','interview_done','offer','rejected'))`).run(now.toISOString()).changes;
  // A ready form's window is closed after WINDOW_MS (the runner closes the browser); the run says so and stops.
  for (const r of db.prepare("select id, heartbeat_at, created_at from agent_runs where state = 'ready' and kind = 'apply'").all() as { id: number; heartbeat_at: string | null; created_at: string }[]) {
    if (now.getTime() - new Date(r.heartbeat_at ?? r.created_at).getTime() > WINDOW_MS) {
      cancel(r.id, now.toISOString(), "The form window was closed after 2 hours without a submit. Press Apply again to refill it.");
    }
  }
  for (const r of db.prepare("select id from agent_runs where state = 'queued' and attempts >= ?").all(MAX_ATTEMPTS) as { id: number }[]) {
    fail(r.id, `Gave up after ${MAX_ATTEMPTS} attempts`, now.toISOString());
    failed++;
  }
  return { failed, done };
}
