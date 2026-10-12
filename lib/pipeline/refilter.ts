/**
 * Re-run the keep/drop rules over stored jobs. Every input `excludedReason` needs is already in the DB:
 * the row itself, the `is_entry_level` posting fact from extraction, the `liveness` fact from the
 * employer-page check, and Claude's `role_evaluations.grad_role` verdict. Writes `excluded_reason` and `intake_status` only where they changed.
 *
 * Why this exists: the sweep used to recompute exclusion from title + location alone on every re-sweep,
 * which silently dropped the LLM's "not entry level" judgement, and a rule added to config/criteria.ts only
 * reached rows that happened to be re-swept. Now the sweep, extraction and the liveness check all end here.
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { excludedReason, intakeStatus, type LivenessStatus } from "./filter";

export interface LivenessValue { status: LivenessStatus; evidence?: string | null; checkedAt?: string; mentionsIntake?: boolean }

export interface RefilterChange { id: number; title: string; from: string | null; to: string | null }
export interface RefilterResult {
  checked: number; changed: number; newlyExcluded: number; newlyKept: number; byReason: Record<string, number>;
  /** every row whose excluded_reason would change (intake-only changes are counted, not listed) */
  changes: RefilterChange[];
}

/**
 * `ids` omitted = every active job. Does not open its own transaction when `inTransaction` (extraction calls it mid-write).
 * `dryRun` computes and reports everything but writes nothing — run it after every criteria edit and read `changes`.
 */
export function refilter(ids?: number[], opts: { today?: string; inTransaction?: boolean; dryRun?: boolean } = {}): RefilterResult {
  const db = getDb();
  const where = ids ? and(eq(schema.jobs.isActive, true), inArray(schema.jobs.id, ids)) : eq(schema.jobs.isActive, true);
  const rows = db.select({
    id: schema.jobs.id, title: schema.jobs.title, locationRaw: schema.jobs.locationRaw, function: schema.jobs.function,
    kind: schema.jobs.kind, startText: schema.jobs.startText, description: schema.jobs.descriptionText, deadline: schema.jobs.deadline,
    excludedReason: schema.jobs.excludedReason, intakeStatus: schema.jobs.intakeStatus,
  }).from(schema.jobs).where(where).all();

  const facts = db.select({ id: schema.facts.entityId, field: schema.facts.field, v: schema.facts.valueJson }).from(schema.facts)
    .where(and(eq(schema.facts.entityType, "job"), inArray(schema.facts.field, ["is_entry_level", "liveness"]), ids ? inArray(schema.facts.entityId, ids) : undefined)).all();
  const entry = new Map<number, boolean | null>(), live = new Map<number, LivenessValue>();
  for (const f of facts) {
    const v = (f.v as { value?: unknown } | null)?.value;
    if (f.field === "is_entry_level") entry.set(f.id, v === true ? true : v === false ? false : null);
    if (f.field === "liveness" && v && typeof v === "object") live.set(f.id, v as LivenessValue);
  }

  const evals = new Map(db.select({ id: schema.roleEvaluations.jobId, verdict: schema.roleEvaluations.gradRole, reason: schema.roleEvaluations.gradRoleReason })
    .from(schema.roleEvaluations).where(ids ? inArray(schema.roleEvaluations.jobId, ids) : undefined).all()
    .map((e) => [e.id, { verdict: e.verdict, reason: e.reason }]));

  const out: RefilterResult = { checked: rows.length, changed: 0, newlyExcluded: 0, newlyKept: 0, byReason: {}, changes: [] };
  const run = () => {
    for (const r of rows) {
      const liveness = live.get(r.id) ?? null;
      // rows extracted before Stage 4 have no is_entry_level fact: the LLM's verdict lives only in the
      // stored reason, so a stored "not entry level" stands until a fact says otherwise
      const isEntryLevel = entry.has(r.id) ? entry.get(r.id)! : r.excludedReason === "not_entry_level:description" ? false : null;
      const reason = excludedReason({ ...r, isEntryLevel, liveness, gradRole: evals.get(r.id) ?? null, today: opts.today });
      let intake = intakeStatus(r).status;
      // the employer's own page naming the intake year settles an otherwise silent posting
      if (intake === "unknown" && liveness?.mentionsIntake) intake = "confirmed";
      if (reason) { const k = reason.split(":")[0]; out.byReason[k] = (out.byReason[k] ?? 0) + 1; }
      if (reason === r.excludedReason && intake === r.intakeStatus) continue;
      if (reason && !r.excludedReason) out.newlyExcluded++;
      if (!reason && r.excludedReason) out.newlyKept++;
      out.changed++;
      if (reason !== r.excludedReason) out.changes.push({ id: r.id, title: r.title, from: r.excludedReason, to: reason });
      if (opts.dryRun) continue;
      db.update(schema.jobs).set({ excludedReason: reason, intakeStatus: intake }).where(eq(schema.jobs.id, r.id)).run();
    }
  };
  if (opts.inTransaction) run(); else db.transaction(run);
  return out;
}
