"use server";

/**
 * Tracker mutations — the only writes the UI performs, and they touch layer 3 only
 * (`applications`, `activity_log`). The pipeline never writes here and this never writes there,
 * which is what makes tracked state survive a re-sweep.
 *
 * Every action validates its input with zod and returns `{ok:false,error}` rather than throwing,
 * so the client can show the real reason instead of swallowing it (spec §7).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { redirect } from "next/navigation";
import { addManualJob } from "@/lib/runs/manual";
import { frontTabUrl, openInBrowser } from "@/lib/runs/browser";
import { getSqlite } from "@/lib/db/client";
import { APPLICATION_STATUSES, RUN_KINDS } from "@/lib/db/schema";
import { reviewAnswer } from "@/lib/apply/answers";
import { answerGap, setLetterApproved, unanswerGap } from "@/lib/kit";
import { answer as answerRunQuestion, cancel as cancelRun, markStaged, requestRun } from "@/lib/runs/runs";
import { DEMO, DEMO_READ_ONLY } from "@/lib/demo";

export type ActionResult = { ok: true } | { ok: false; error: string };

const JobId = z.coerce.number().int().positive();
const Status = z.enum(APPLICATION_STATUSES);

const TrackerInput = z.object({
  jobId: JobId,
  nextAction: z.string().trim().max(400).nullable(),
  nextActionDue: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullable(),
  notes: z.string().trim().max(20_000).nullable(),
});

const nowIso = () => new Date().toISOString();

/** Creates the application row on first touch, so an untracked job needs no setup. */
function ensureApplication(jobId: number): { id: number; status: string } {
  const db = getSqlite();
  const existing = db.prepare("select id, status from applications where job_id = ?").get(jobId) as
    { id: number; status: string } | undefined;
  if (existing) return existing;

  const job = db.prepare("select id from jobs where id = ?").get(jobId);
  if (!job) throw new Error(`No job ${jobId}`);

  const info = db.prepare(
    "insert into applications (job_id, status, updated_at) values (?, 'discovered', ?)",
  ).run(jobId, nowIso());
  return { id: Number(info.lastInsertRowid), status: "discovered" };
}

export async function setStatus(raw: { jobId: unknown; status: unknown }): Promise<ActionResult> {
  if (DEMO) return DEMO_READ_ONLY;
  const parsed = z.object({ jobId: JobId, status: Status }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { jobId, status } = parsed.data;

  try {
    const db = getSqlite();
    const app = ensureApplication(jobId);
    if (app.status === status) return { ok: true };

    db.transaction(() => {
      db.prepare(`update applications set status = ?, updated_at = ?,
                  applied_at = case when ? in ('applied','tests','tests_done','hirevue','hirevue_done','interview','interview_done','offer') and applied_at is null then ? else applied_at end
                  where id = ?`)
        .run(status, nowIso(), status, nowIso(), app.id);
      db.prepare("insert into activity_log (application_id, from_status, to_status, at) values (?,?,?,?)")
        .run(app.id, app.status, status, nowIso());
    })();

    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/");
    revalidatePath("/applications");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function saveTracker(raw: unknown): Promise<ActionResult> {
  if (DEMO) return DEMO_READ_ONLY;
  const parsed = TrackerInput.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, error: `${i?.path.join(".") || "input"}: ${i?.message ?? "invalid"}` };
  }
  const { jobId, nextAction, nextActionDue, notes } = parsed.data;

  try {
    const db = getSqlite();
    const app = ensureApplication(jobId);
    db.prepare(`update applications
                set next_action = ?, next_action_due = ?, notes = ?, updated_at = ?
                where id = ?`)
      .run(nextAction || null, nextActionDue || null, notes || null, nowIso(), app.id);

    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/");
    revalidatePath("/applications");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Notes only (the role page's Tracker panel): never touches the next step, which has its own editor (NextStep). */
export async function saveNotes(raw: { jobId: unknown; notes: unknown }): Promise<ActionResult> {
  if (DEMO) return DEMO_READ_ONLY;
  const parsed = TrackerInput.pick({ jobId: true, notes: true }).safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, error: `${i?.path.join(".") || "input"}: ${i?.message ?? "invalid"}` };
  }
  try {
    const app = ensureApplication(parsed.data.jobId);
    getSqlite().prepare("update applications set notes = ?, updated_at = ? where id = ?")
      .run(parsed.data.notes || null, nowIso(), app.id);
    revalidatePath(`/jobs/${parsed.data.jobId}`);
    revalidatePath("/applications");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Set, change or clear (both null) the next step from the Applications page. Touches only next_action and its due
 * date — unlike saveTracker, it never overwrites notes.
 */
export async function setNextStep(raw: { jobId: unknown; nextAction: unknown; nextActionDue: unknown }): Promise<ActionResult> {
  if (DEMO) return DEMO_READ_ONLY;
  const parsed = TrackerInput.pick({ jobId: true, nextAction: true, nextActionDue: true }).safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, error: `${i?.path.join(".") || "input"}: ${i?.message ?? "invalid"}` };
  }
  const { jobId, nextAction, nextActionDue } = parsed.data;
  if (!nextAction && nextActionDue) return { ok: false, error: "A due date needs a step to go with it" };

  try {
    const app = ensureApplication(jobId);
    getSqlite().prepare("update applications set next_action = ?, next_action_due = ?, updated_at = ? where id = ?")
      .run(nextAction || null, nextActionDue || null, nowIso(), app.id);
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/applications");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Tick off (or reopen) an action that came from a recruiter email. Touches only that email row. */
export async function setEmailActionDone(raw: { id: unknown; done: unknown }): Promise<ActionResult> {
  if (DEMO) return DEMO_READ_ONLY;
  const parsed = z.object({ id: z.coerce.number().int().positive(), done: z.boolean() }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  try {
    const r = getSqlite().prepare("update email_updates set action_done = ? where id = ?").run(parsed.data.done ? 1 : 0, parsed.data.id);
    if (r.changes === 0) return { ok: false, error: `No email update ${parsed.data.id}` };
    revalidatePath("/applications");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Save Jonno's edit to a drafted answer, or approve exactly this text for the form-filler. */
export async function reviewAnswerAction(raw: { id: unknown; text: unknown; approve: unknown; jobId: unknown }): Promise<ActionResult> {
  if (DEMO) return DEMO_READ_ONLY;
  const parsed = z.object({ id: z.coerce.number().int().positive(), text: z.string().max(20_000), approve: z.boolean(), jobId: JobId }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  try {
    reviewAnswer(parsed.data.id, parsed.data.text, parsed.data.approve);
    revalidatePath(`/jobs/${parsed.data.jobId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const revalidateRun = (jobId: number) => {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/");
  revalidatePath("/applications");
};

/** Apply or Research: queue one run for the runner (lib/runs/runs.ts). An existing live run is reused, not duplicated. */
export async function requestRunAction(raw: { jobId: unknown; kind: unknown; useOpenTab?: unknown }): Promise<ActionResult> {
  if (DEMO) return DEMO_READ_ONLY;
  const parsed = z.object({ jobId: JobId, kind: z.enum(RUN_KINDS), useOpenTab: z.boolean().optional() }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  try {
    // Apply from the form tab Jonno already opened: its URL becomes the run's formUrl, and the agent fills that tab.
    const formUrl = parsed.data.useOpenTab ? await frontTabUrl() : null;
    if (parsed.data.useOpenTab && !formUrl) return { ok: false, error: "No form tab found in the gradfinder Chrome window. Open the form there first." };
    requestRun(parsed.data.jobId, parsed.data.kind, undefined, formUrl ? { formUrl } : {});
    markStaged(false); // the queued run now keeps the window open
    revalidateRun(parsed.data.jobId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Jonno answers a question card. The last open answer re-queues the run. */
export async function answerQuestionAction(raw: { questionId: unknown; answer: unknown; jobId: unknown }): Promise<ActionResult> {
  if (DEMO) return DEMO_READ_ONLY;
  const parsed = z.object({ questionId: z.coerce.number().int().positive(), answer: z.string().max(4000), jobId: JobId }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  try {
    answerRunQuestion(parsed.data.questionId, parsed.data.answer);
    revalidateRun(parsed.data.jobId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * A `login` card: open the employer's site in the run browser (lib/runs/browser.ts), so the login Jonno does here is
 * the one the run sees. Local machine only; https URLs only. He types his own password.
 */
export async function openLoginBrowserAction(raw: { url: unknown }): Promise<ActionResult> {
  if (DEMO) return DEMO_READ_ONLY;
  const parsed = z.object({ url: z.string().url().refine((u) => u.startsWith("https://"), "Only https links") }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid link" };
  try {
    await openInBrowser(parsed.data.url);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Apply step 1: open the job's apply page in the run browser so Jonno can click through to the form himself. */
export async function openApplyBrowserAction(raw: { jobId: unknown }): Promise<ActionResult> {
  if (DEMO) return DEMO_READ_ONLY;
  const parsed = z.object({ jobId: JobId }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  try {
    const row = getSqlite().prepare("select coalesce(apply_url, canonical_url) as url from jobs where id = ?").get(parsed.data.jobId) as { url: string | null } | undefined;
    if (!row?.url) return { ok: false, error: "This role has no apply link" };
    markStaged(true);
    await openInBrowser(row.url);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function cancelRunAction(raw: { runId: unknown; jobId: unknown }): Promise<ActionResult> {
  if (DEMO) return DEMO_READ_ONLY;
  const parsed = z.object({ runId: z.coerce.number().int().positive(), jobId: JobId }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  try {
    if (!cancelRun(parsed.data.runId)) return { ok: false, error: "That run has already finished" };
    revalidateRun(parsed.data.jobId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function dismiss(raw: { jobId: unknown; reason: unknown }): Promise<ActionResult> {
  if (DEMO) return DEMO_READ_ONLY;
  const parsed = z.object({ jobId: JobId, reason: z.string().trim().max(400).nullable() })
    .safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { jobId, reason } = parsed.data;

  try {
    const db = getSqlite();
    const app = ensureApplication(jobId);
    db.transaction(() => {
      db.prepare(`update applications set status = 'dismissed', dismissed_reason = ?, updated_at = ?
                  where id = ?`).run(reason || null, nowIso(), app.id);
      db.prepare(`insert into activity_log (application_id, from_status, to_status, note, at)
                  values (?,?,'dismissed',?,?)`).run(app.id, app.status, reason || null, nowIso());
    })();

    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/");
    revalidatePath("/applications");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---- /kit: Jonno's own answers written back to his store (lib/kit.ts). Local files only, never sent anywhere.

const kitDone = (): ActionResult => { revalidatePath("/kit"); return { ok: true }; };
const kitError = (e: unknown): ActionResult => ({ ok: false, error: e instanceof Error ? e.message : String(e) });
const GapAnswer = z.object({ raw: z.string().min(1).max(2_000), answer: z.string().trim().min(1, "Type an answer first").max(5_000) });

/**
 * Answer an open question from questions.md: ticks it and stores the answer under it as [CONFIRMED]. No revalidate:
 * the row shows Undo for a few seconds and the client refreshes after that (KitTodo useSaved).
 */
export async function answerGapAction(raw: { raw: unknown; answer: unknown }): Promise<ActionResult> {
  if (DEMO) return DEMO_READ_ONLY;
  const p = GapAnswer.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid input" };
  try { answerGap(p.data.raw, p.data.answer); return { ok: true }; } catch (e) { return kitError(e); }
}

/** Undo of answerGapAction. */
export async function unanswerGapAction(raw: { raw: unknown; answer: unknown }): Promise<ActionResult> {
  if (DEMO) return DEMO_READ_ONLY;
  const p = GapAnswer.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid input" };
  try { unanswerGap(p.data.raw, p.data.answer); return { ok: true }; } catch (e) { return kitError(e); }
}

/** Approve (or take back approval of) the base cover letter. */
export async function letterApprovalAction(raw: { approve: unknown }): Promise<ActionResult> {
  if (DEMO) return DEMO_READ_ONLY;
  const p = z.object({ approve: z.boolean() }).safeParse(raw);
  if (!p.success) return { ok: false, error: "Invalid input" };
  try { setLetterApproved(p.data.approve); return kitDone(); } catch (e) { return kitError(e); }
}

const FillInput = z.object({
  url: z.string().trim().url("Paste the full form URL").refine((u) => /^https?:/i.test(u), "Use an http(s) URL"),
  company: z.string().trim().min(1, "Company is required").max(120),
  title: z.string().trim().min(1, "Role title is required").max(200),
});

/** "Fill a form": a minimal manual job plus a queued apply run for a form outside the sweep results (lib/runs/manual.ts). */
export async function addManualRunAction(raw: unknown): Promise<{ ok: true; jobId: number } | { ok: false; error: string }> {
  if (DEMO) return DEMO_READ_ONLY;
  const parsed = FillInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  try {
    const { jobId } = addManualJob(parsed.data);
    revalidateRun(jobId);
    return { ok: true, jobId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The /fill form: on success go to the role page (RunPanel), else back with the error. */
export async function fillFormAction(fd: FormData): Promise<void> {
  const r = await addManualRunAction({ url: fd.get("url"), company: fd.get("company"), title: fd.get("title") });
  redirect(r.ok ? `/jobs/${r.jobId}` : `/fill?error=${encodeURIComponent(r.error)}`);
}
