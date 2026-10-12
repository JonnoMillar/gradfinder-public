/**
 * What on the Applications page needs Jonno, and how soon. Pure: takes the rows the page already reads and a clock,
 * so the urgency rules are unit-tested rather than eyeballed.
 *
 * Three kinds of dated item: an action a recruiter email asked for, a next step Jonno set himself, and the posting's
 * deadline for a role he hasn't submitted yet. Plus "calls": a role he still means to apply for whose listing looks
 * closed or was filtered out — that needs a keep-or-dismiss decision, not a countdown.
 */
import type { ApplicationRow, EmailUpdateRow } from "@/lib/queries";
import { daysUntil } from "@/lib/ui/format";

/** Submitted, in pipeline order. The `_done` statuses are a step ticked off (sat, recorded, had): waiting on them. */
export const SUBMITTED: readonly string[] = ["applied", "tests", "tests_done", "hirevue", "hirevue_done", "interview", "interview_done", "offer"];
export const PRE_SUBMIT: ReadonlySet<string> = new Set(["discovered", "interested", "applying"]);
export const FINISHED: ReadonlySet<string> = new Set(["closed", "rejected", "dismissed"]);

/** now = today, tomorrow or late · soon = within a week · later = beyond that */
export type Level = "now" | "soon" | "later";
export function levelFor(days: number): Level {
  return days <= 1 ? "now" : days <= 7 ? "soon" : "later";
}

export interface AttentionItem {
  key: string;
  kind: "email" | "step" | "deadline";
  level: Level;
  /** negative = late */
  days: number;
  date: string;
  text: string;
  company: string;
  logoUrl: string | null;
  domain: string | null;
  jobId: number | null;
  title: string | null;
  email?: EmailUpdateRow;
}

export interface Call { app: ApplicationRow; reason: string }

/** Why a role Jonno hasn't submitted yet may no longer be worth his time. Submitted roles don't care. */
export function callFor(a: ApplicationRow, now = new Date()): string | null {
  if (!PRE_SUBMIT.has(a.status)) return null;
  if (a.live?.status === "closed") return `Listing looks closed: ${a.live.evidence}`;
  if (!a.jobActive) return "No longer listed on any source";
  if (a.excludedReason === "deadline_passed" || (daysUntil(a.deadline, now) ?? 0) < 0) return "Deadline has passed";
  if (a.excludedReason) return `Filtered out: ${a.excludedReason.split(":")[0].replace(/_/g, " ")}`;
  return null;
}

const KIND_ORDER = { email: 0, step: 1, deadline: 2 } as const;

export function attention(apps: ApplicationRow[], emails: EmailUpdateRow[], now = new Date()): { items: AttentionItem[]; calls: Call[] } {
  const byAppId = new Map(apps.map((a) => [a.id, a]));
  const items: AttentionItem[] = [];
  const push = (it: Omit<AttentionItem, "level" | "days">, days: number) => items.push({ ...it, days, level: levelFor(days) });

  // One open ask per application: recruiters re-send the same ask as reminders (and the sync can see two copies of one
  // email), so the newest email's action supersedes the older ones, which would only repeat it, often with a stale date.
  const newest = new Map<number, EmailUpdateRow>();
  for (const e of emails) {
    if (!e.actionText || e.actionDone || !e.actionDue || e.applicationId == null) continue;
    const cur = newest.get(e.applicationId);
    if (!cur || e.receivedAt > cur.receivedAt || (e.receivedAt === cur.receivedAt && e.id > cur.id)) newest.set(e.applicationId, e);
  }

  for (const e of emails) {
    if (!e.actionText || e.actionDone || !e.actionDue) continue;
    if (e.applicationId != null && newest.get(e.applicationId) !== e) continue;
    const a = e.applicationId ? byAppId.get(e.applicationId) : undefined;
    if (a && FINISHED.has(a.status)) continue;
    const d = daysUntil(e.actionDue, now);
    if (d === null) continue;
    push({
      key: `e${e.id}`, kind: "email", date: e.actionDue, text: e.actionText,
      company: a?.company ?? e.company ?? e.companyHint ?? e.sender, logoUrl: a?.logoUrl ?? null, domain: a?.domain ?? null,
      jobId: a?.jobId ?? e.jobId, title: a?.title ?? e.title, email: e,
    }, d);
  }

  const calls: Call[] = [];
  for (const a of apps) {
    if (FINISHED.has(a.status)) continue;
    const base = { company: a.company, logoUrl: a.logoUrl, domain: a.domain, jobId: a.jobId, title: a.title };
    const step = daysUntil(a.nextActionDue, now);
    if (a.nextAction && step !== null) push({ ...base, key: `s${a.id}`, kind: "step", date: a.nextActionDue!, text: a.nextAction }, step);
    const reason = callFor(a, now);
    if (reason) { calls.push({ app: a, reason }); continue; }   // a dead listing's deadline is noise, the call covers it
    const dl = daysUntil(a.deadline, now);
    if (PRE_SUBMIT.has(a.status) && dl !== null && dl >= 0) {
      push({ ...base, key: `d${a.id}`, kind: "deadline", date: a.deadline!, text: "Applications close" }, dl);
    }
  }

  items.sort((x, y) => x.days - y.days || KIND_ORDER[x.kind] - KIND_ORDER[y.kind]);
  return { items, calls };
}

/** "Today", "Tomorrow", "3 days", "2 days late" */
export function whenLabel(days: number): string {
  if (days < -1) return `${-days} days late`;
  if (days === -1) return "1 day late";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `${days} days`;
}
