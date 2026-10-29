/**
 * Ranking v2 (2026-09-24). Two regimes, every term kept in `rank_breakdown` so the UI can show why:
 *
 * - **Evaluated by Claude** (lib/evaluate, a `role_evaluations` row): the six-part rubric, 0–100 —
 *   work fit 30 · realistic chance 20 · company type 15 · career path 15 · sector 10 · pay 10 —
 *   plus −50 for a dealbreaker (−25, or nothing when London is a listed office, for the vaguer `outside_london`), −5 for "register interest" (nothing to apply to yet), −30 for a role that demands a
 *   first (Jonno is predicted a 2:1). An unconfirmed 2027 intake is a note on the page, not a rank term (Jonno,
 *   2026-09-25: it shouldn't affect the ranking).
 * - **Not evaluated yet** (new from a sweep): the v1 formula minus 100, so it always sits below every evaluated
 *   role and shows "not evaluated" instead of pretending to a score.
 *
 * The deadline is NOT in either score any more (v1 counted it twice, via urgency and the list's own date sort);
 * the list offers a separate "closing soon" view.
 */
import { eq } from "drizzle-orm";
import { SECTOR_WEIGHTS, SPORT_COMPANIES } from "@/config/criteria";
import { getDb, schema } from "@/lib/db/client";
import type { Eligibility, EvalScores, JobKind } from "@/lib/db/schema";
import { dealbreakerPenalty, evaluationPoints } from "@/lib/evaluate";

export interface RankInput {
  sector: string | null;
  aiForward: number | null;          // 0–3
  deadline: string | null;           // YYYY-MM-DD (v1 only)
  eligibility: Eligibility | null;
  kind: JobKind;
  evaluation?: { scores: EvalScores; dealbreakers: { kind: string }[] } | null;
  /** anything to do with sport (company sector, evaluation family or SPORT_COMPANIES) */
  sport?: boolean;
  /** tech/AI work or a tech/AI company (evaluation family or company sector) */
  tech?: boolean;
  /** London is one of the posting's listed locations (jobs.is_london). Decides how heavy an `outside_london` flag is. */
  londonListed?: boolean;
}

/**
 * Sport and tech/AI each already earn the sector score's 5/5. A sports-tech role (Catapult, Genius Sports engineering)
 * is both, and Jonno wants that to compound a bit (2026-09-28): this bonus on top.
 */
export const SPORT_TECH_BONUS = 4;
const TECH_FAMILIES = new Set(["data_ai", "software_engineering", "product"]);
const TECH_SECTORS = new Set(["ai", "big_tech", "deep_tech", "consumer_tech"]);
const SPORT_NAMES = new Set(SPORT_COMPANIES.map((n) => n.toLowerCase()));
export type RankBreakdown = Record<string, number>;

const KIND_BONUS: Record<JobKind, number> = {
  graduate_scheme: 2, graduate_job: 1, register_interest: 1, internship: 0, placement: 0, insight: -1, other: -1, unknown: 0,
};
const DAY_MS = 86_400_000;
export const NOT_EVALUATED_OFFSET = -100;

export function scoreJob(j: RankInput, today = new Date()): { score: number; breakdown: RankBreakdown } {
  const breakdown: RankBreakdown = j.evaluation ? evaluatedBreakdown(j, j.evaluation) : legacyBreakdown(j, today);
  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { score: Math.round(score * 10) / 10, breakdown };
}

function evaluatedBreakdown(j: RankInput, e: NonNullable<RankInput["evaluation"]>): RankBreakdown {
  const p = evaluationPoints(e.scores);
  const b: RankBreakdown = {
    work_fit: p.workFit, chance: p.chance, company_type: p.companyType, career_path: p.careerPath, sector: p.sector, pay: p.pay,
  };
  if (j.sport && j.tech) b.sport_tech = SPORT_TECH_BONUS;
  // no key when the penalty is 0: the Apply now query skips any role with a `dealbreaker` term
  const penalty = dealbreakerPenalty(e.dealbreakers.map((d) => d.kind), !!j.londonListed);
  if (penalty) b.dealbreaker = penalty;
  if (j.kind === "register_interest") b.register_interest = -5;
  if (requiresFirst(j.eligibility)) b.requires_first = -30;
  return b;
}

/** v1 (design spec §4), kept for roles Claude hasn't evaluated yet, offset below every evaluated role. */
function legacyBreakdown(j: RankInput, today: Date): RankBreakdown {
  return {
    not_evaluated: NOT_EVALUATED_OFFSET,
    sector_weight: (j.sector ? SECTOR_WEIGHTS[j.sector] : undefined) ?? 1,
    ai_forward: (j.aiForward ?? 0) * 2,
    deadline_urgency: deadlineUrgency(j.deadline, today),
    eligibility_risk: requiresFirst(j.eligibility) ? -3 : 0,
    kind_bonus: KIND_BONUS[j.kind] ?? 0,
  };
}

/** 0 far out → 1 (≤30d) → 2 (≤14d) → 3 (≤7d); closed sinks to −2. Unknown deadline = 0 (rolling). */
function deadlineUrgency(deadline: string | null, today: Date): number {
  if (!deadline) return 0;
  const d = Date.parse(deadline);
  if (Number.isNaN(d)) return 0;
  const days = Math.floor((d - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / DAY_MS);
  if (days < 0) return -2;
  if (days <= 7) return 3;
  if (days <= 14) return 2;
  if (days <= 30) return 1;
  return 0;
}

/** Jonno is predicted 2:1: a scheme that demands a first is shown but scored as a risk. */
function requiresFirst(e: Eligibility | null): boolean {
  const c = e?.degree_class?.trim().toLowerCase();
  return !!c && (c === "1st" || c === "1" || c.startsWith("first"));
}

/** Re-score every active job. Returns the number updated. */
export function rankAll(today = new Date()): number {
  const db = getDb();
  const rows = db.select({
    id: schema.jobs.id, kind: schema.jobs.kind, londonListed: schema.jobs.isLondon, deadline: schema.jobs.deadline, eligibility: schema.jobs.eligibility,
    sector: schema.companies.sector, aiForward: schema.companies.aiForward, company: schema.companies.name,
    evalScores: schema.roleEvaluations.scores, evalDealbreakers: schema.roleEvaluations.dealbreakers,
    family: schema.roleEvaluations.family,
  }).from(schema.jobs).innerJoin(schema.companies, eq(schema.companies.id, schema.jobs.companyId))
    .leftJoin(schema.roleEvaluations, eq(schema.roleEvaluations.jobId, schema.jobs.id))
    .where(eq(schema.jobs.isActive, true)).all();
  db.transaction(() => {
    for (const r of rows) {
      const evaluation = r.evalScores ? { scores: r.evalScores, dealbreakers: r.evalDealbreakers ?? [] } : null;
      const sport = r.sector === "sport" || r.family === "sport" || SPORT_NAMES.has(r.company.toLowerCase());
      const tech = TECH_FAMILIES.has(r.family ?? "") || TECH_SECTORS.has(r.sector ?? "");
      const { score, breakdown } = scoreJob({ ...r, evaluation, sport, tech }, today);
      db.update(schema.jobs).set({ rankScore: score, rankBreakdown: breakdown }).where(eq(schema.jobs.id, r.id)).run();
    }
  });
  return rows.length;
}
