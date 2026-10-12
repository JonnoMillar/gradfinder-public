/**
 * Gmail → tracker. A Claude run (scheduled task, see docs/HANDOFF.md) reads recruiter emails, classifies each
 * one, and hands them here as JSON via `npm run track -- record <file>`. This file is the ONLY code path that
 * writes layer 3 on Jonno's behalf, and it is deliberately conservative:
 *
 *  - one row per Gmail message id, so re-reading the inbox never double-applies an email;
 *  - an email only moves an application FORWARD (applied → tests → interview → offer), or to rejected; it never
 *    touches a dismissed application and never moves one backwards;
 *  - it never overwrites Jonno's own next action or notes — an email's action lives on the email row and shows
 *    in "Action needed" until he ticks it off;
 *  - an email that matches nothing tracked is stored unlinked and shown, never dropped and never guessed.
 *
 * Emails are data. Nothing here follows a link or sends anything.
 */
import { z } from "zod";
import { getSqlite } from "@/lib/db/client";
import { EMAIL_KINDS, type ApplicationStatus, type EmailKind } from "@/lib/db/schema";
import { companySlug } from "@/lib/pipeline/normalise";

export const EmailUpdateInput = z.object({
  gmailMessageId: z.string().min(1),
  threadId: z.string().nullish(),
  viewUrl: z.string().url().nullish(),
  receivedAt: z.string().min(10),
  sender: z.string().min(1),
  subject: z.string().min(1),
  kind: z.enum(EMAIL_KINDS),
  summary: z.string().max(500).nullish(),
  company: z.string().nullish(),
  role: z.string().nullish(),
  /** set when the caller already knows which application or job this is */
  applicationId: z.number().int().positive().nullish(),
  jobId: z.number().int().positive().nullish(),
  actionText: z.string().max(400).nullish(),
  actionDue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});
export type EmailUpdate = z.infer<typeof EmailUpdateInput>;

export type RecordOutcome =
  | { gmailMessageId: string; result: "duplicate" }
  | { gmailMessageId: string; result: "recorded"; applicationId: number | null; matchedBy: string; statusFrom?: string; statusTo?: string };

/**
 * How far along each status is. rejected/dismissed/closed are terminal and handled separately. `interview_done` sits
 * just below `interview` on purpose: a new interview invite after one is done is the next round, so it re-opens the step.
 */
const TERMINAL = new Set(["dismissed", "rejected", "closed"]);
const STAGE: Record<string, number> = { discovered: 0, interested: 1, applying: 2, applied: 3, tests: 4, tests_done: 4.5, hirevue: 4.7, hirevue_done: 4.8, interview_done: 4.9, interview: 5, offer: 6 };
const TARGET: Partial<Record<EmailKind, ApplicationStatus>> = {
  received: "applied", assessment_invite: "tests", interview_invite: "interview", offer: "offer", rejection: "rejected",
};

/** A recorded video interview (HireVue and the like): an assessment invite that should land on the HireVue stage. */
const VIDEO = /hire ?vue|video interview|recorded interview|sonru|launchpad|modern hire/i;

/**
 * The status an email should move an application to, or null to leave it alone. Pure — tested directly. `text` is the
 * email's subject and asked-for action: an assessment invite that names a HireVue moves to `hirevue`, not `tests`.
 */
export function nextStatus(current: string, kind: EmailKind, text = ""): ApplicationStatus | null {
  const target = kind === "assessment_invite" && VIDEO.test(text) ? "hirevue" : TARGET[kind];
  if (!target || TERMINAL.has(current) || current === target) return null;
  if (target === "rejected") return current === "offer" ? null : "rejected";
  return (STAGE[target] ?? -1) > (STAGE[current] ?? -1) ? target : null;
}

const words = (s: string | null | undefined) =>
  new Set((s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !/^(20\d\d|graduate|programme|program|scheme|the|and)$/.test(w)));

interface Candidate { applicationId: number | null; jobId: number; status: string | null; title: string; employerTitle: string | null; slug: string }

/**
 * Which application an email is about. Explicit ids win; otherwise the company must match (slug equality or one
 * containing the other: "JPMorganChase" / "J.P. Morgan" are not merged — ambiguity stays unlinked), and among
 * that company's tracked roles the role hint picks one by word overlap with either gradfinder's title or the employer's own
 * title stored on the application (one employer's form and confirmation named a different track than the listing). A tie is not a match.
 */
function match(db: ReturnType<typeof getSqlite>, u: EmailUpdate): { applicationId: number | null; jobId: number | null; by: string } {
  if (u.applicationId) return { applicationId: u.applicationId, jobId: null, by: "applicationId" };
  if (u.jobId) {
    const a = db.prepare("select id from applications where job_id = ?").get(u.jobId) as { id: number } | undefined;
    return { applicationId: a?.id ?? null, jobId: u.jobId, by: "jobId" };
  }
  if (!u.company) return { applicationId: null, jobId: null, by: "no company given" };
  const want = companySlug(u.company);
  const tracked = (db.prepare(`
    select a.id as applicationId, j.id as jobId, a.status, j.title, a.employer_title as employerTitle, c.slug from applications a
    join jobs j on j.id = a.job_id join companies c on c.id = j.company_id`).all() as Candidate[])
    // whole slug words only: "ey" must not match "eyeon"
    .filter((c) => c.slug === want || c.slug.startsWith(`${want}-`) || want.startsWith(`${c.slug}-`));
  // The email names a different track than the employer's own title for this application: each side has words the
  // other lacks ("Software Engineering" vs "Data & Insights"). A real backup-track choice did exactly this.
  const otherTrack = (c: Candidate) => {
    if (!u.role || !c.employerTitle) return false;
    const role = words(u.role), mine = words(c.employerTitle);
    return [...role].some((w) => !mine.has(w)) && [...mine].some((w) => !role.has(w));
  };
  if (tracked.length === 1 && otherTrack(tracked[0])) return { applicationId: null, jobId: null, by: `another track at ${u.company}` };
  if (tracked.length === 1) return { applicationId: tracked[0].applicationId, jobId: tracked[0].jobId, by: "company (only tracked role)" };
  if (tracked.length > 1) {
    const role = words(u.role ?? u.subject);
    // The role title the employer's own form/confirmation showed (stored by an apply run) counts as much as gradfinder's title.
    const overlap = (t: string | null) => [...words(t)].filter((w) => role.has(w)).length;
    const scored = tracked.map((c) => ({ c, n: Math.max(overlap(c.title), overlap(c.employerTitle)) })).sort((a, b) => b.n - a.n);
    if (scored[0].n > 0 && scored[0].n > (scored[1]?.n ?? 0) && !otherTrack(scored[0].c)) return { applicationId: scored[0].c.applicationId, jobId: scored[0].c.jobId, by: "company + role words" };
    return { applicationId: null, jobId: null, by: `ambiguous: ${tracked.length} tracked roles at ${u.company}` };
  }
  return { applicationId: null, jobId: null, by: `no tracked role at ${u.company}` };
}

/** Records one email and applies its status change. Idempotent on gmailMessageId. */
export function recordEmailUpdate(raw: unknown, now = new Date().toISOString()): RecordOutcome {
  const u = EmailUpdateInput.parse(raw);
  const db = getSqlite();
  if (db.prepare("select 1 from email_updates where gmail_message_id = ?").get(u.gmailMessageId)) {
    return { gmailMessageId: u.gmailMessageId, result: "duplicate" };
  }

  return db.transaction((): RecordOutcome => {
    const m = match(db, u);
    const jobId = m.jobId;
    let { applicationId, by } = m;
    // "we've received your application" for a role we list but never tracked: he applied, so track it
    if (!applicationId && jobId && u.kind !== "other") {
      applicationId = Number(db.prepare("insert into applications (job_id, status, updated_at) values (?, 'discovered', ?)").run(jobId, now).lastInsertRowid);
      by += " (application created)";
    }

    let statusFrom: string | undefined, statusTo: string | undefined;
    if (applicationId) {
      const app = db.prepare("select id, status from applications where id = ?").get(applicationId) as { id: number; status: string } | undefined;
      if (!app) throw new Error(`No application ${applicationId}`);
      const to = nextStatus(app.status, u.kind, `${u.subject} ${u.actionText ?? ""}`);
      if (to) {
        statusFrom = app.status; statusTo = to;
        db.prepare(`update applications set status = ?, updated_at = ?,
                    applied_at = case when applied_at is null and ? in ('applied','tests','tests_done','hirevue','hirevue_done','interview','interview_done','offer') then ? else applied_at end
                    where id = ?`).run(to, now, to, u.receivedAt, app.id);
        db.prepare("insert into activity_log (application_id, from_status, to_status, note, at) values (?,?,?,?,?)")
          .run(app.id, app.status, to, `Gmail: ${u.subject} (${u.receivedAt.slice(0, 10)})`, now);
      }
    }

    db.prepare(`insert into email_updates (gmail_message_id, thread_id, view_url, received_at, sender, subject, kind, summary,
                company_hint, role_hint, application_id, status_applied, action_text, action_due, created_at)
                values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(u.gmailMessageId, u.threadId ?? null, u.viewUrl ?? null, u.receivedAt, u.sender, u.subject, u.kind, u.summary ?? null,
        u.company ?? null, u.role ?? null, applicationId, statusTo ?? null, u.actionText ?? null, u.actionDue ?? null, now);

    return { gmailMessageId: u.gmailMessageId, result: "recorded", applicationId, matchedBy: by, statusFrom, statusTo };
  })();
}

/**
 * An application run's own status moves: `start` (→ applying) and `applied` (→ applied, after Jonno submits).
 * Same forward-only rule as email; creates the application on first touch. Returns what happened.
 */
export function automationStatus(jobId: number, to: "applying" | "applied", note: string, now = new Date().toISOString()) {
  const db = getSqlite();
  if (!db.prepare("select 1 from jobs where id = ?").get(jobId)) throw new Error(`No job ${jobId}`);
  return db.transaction(() => {
    let app = db.prepare("select id, status from applications where job_id = ?").get(jobId) as { id: number; status: string } | undefined;
    if (!app) {
      const id = Number(db.prepare("insert into applications (job_id, status, updated_at) values (?, 'discovered', ?)").run(jobId, now).lastInsertRowid);
      app = { id, status: "discovered" };
    }
    const moves = !TERMINAL.has(app.status) && (STAGE[to] ?? -1) > (STAGE[app.status] ?? -1);
    if (!moves) return { applicationId: app.id, status: app.status, moved: false };
    db.prepare(`update applications set status = ?, updated_at = ?,
                applied_at = case when ? = 'applied' and applied_at is null then ? else applied_at end where id = ?`)
      .run(to, now, to, now, app.id);
    db.prepare("insert into activity_log (application_id, from_status, to_status, note, at) values (?,?,?,?,?)").run(app.id, app.status, to, note, now);
    return { applicationId: app.id, status: to, moved: true };
  })();
}

/** What the Gmail run needs to know before it searches: what's tracked, and how far back it has already read. */
export function trackerContext() {
  const db = getSqlite();
  const applications = db.prepare(`
    select a.id as applicationId, j.id as jobId, c.name as company, j.title, a.employer_title as employerTitle, a.status, a.applied_at as appliedAt
    from applications a join jobs j on j.id = a.job_id join companies c on c.id = j.company_id order by c.name`).all();
  const last = db.prepare("select max(received_at) as at from email_updates").get() as { at: string | null };
  return { applications, lastEmailReceivedAt: last.at };
}
