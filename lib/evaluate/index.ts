/**
 * Claude role evaluation (2026-09-24, Jonno: "Claude does the research and evaluation of each role, not the free
 * providers"). A Claude session (Sonnet subagents, in batches) reads each posting against Jonno's preferences and the
 * rubric in docs/automation/evaluate-roles.md, and writes a JSON file; `npm run evaluate -- import` validates it here.
 *
 * Scoring (RUBRIC_VERSION 1), from the ranking Q&A in chat on 2026-09-24:
 *   work fit 30 · realistic chance 20 · company type 15 · career path 15 · sector 10 · pay 10  → 0–100
 * Each part is 1–5 and maps linearly to 0–weight. Pay unknown = 3 (neutral: missing information is never a penalty).
 * A dealbreaker (heavy hours, mostly outside London, old-fashioned employer) subtracts 50 so the role sinks, visibly.
 */
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db/client";
import type { EvalScores } from "@/lib/db/schema";

export const RUBRIC_VERSION = 1;

export const WEIGHTS: Record<keyof EvalScores, number> = {
  workFit: 30, chance: 20, companyType: 15, careerPath: 15, sector: 10, pay: 10,
};
export const DEALBREAKER_PENALTY = -50;
/** `outside_london` is Claude's read of a vague or multi-site posting: heavy only when London is not a listed office
 *  (Jonno 2026-10-27: unclear locations must not be ruled out). A London-listed role keeps the flag as a note only. */
export const OUTSIDE_LONDON_PENALTY = -25;
/** Rank penalty for a role's dealbreakers: the heaviest one that applies, 0 when none do. `londonListed` = London is one of the posting's offices. */
export function dealbreakerPenalty(kinds: string[], londonListed: boolean): number {
  return Math.min(0, ...kinds.map((k) => (k === "outside_london" ? (londonListed ? 0 : OUTSIDE_LONDON_PENALTY) : DEALBREAKER_PENALTY)));
}
export const DEALBREAKER_KINDS = ["hours", "outside_london", "old_fashioned"] as const;
export const FAMILIES = [
  "data_ai", "tech_consulting", "consulting", "strategy", "product", "banking_markets", "quant", "software_engineering",
  "finance", "operations", "sport", "other",
] as const;

const score = z.number().int().min(1).max(5);
const line = z.string().trim().min(3).max(400);

export const EvaluationInput = z.object({
  jobId: z.number().int().positive(),
  gradRole: z.enum(["yes", "no", "unsure"]),
  gradRoleReason: line,
  family: z.enum(FAMILIES),
  oneLine: z.string().trim().min(3).max(160),
  dayToDay: z.string().trim().min(20).max(900),
  scores: z.object({ workFit: score, chance: score, companyType: score, careerPath: score, sector: score, pay: score.nullable() }),
  reasons: z.object({ workFit: line, chance: line, companyType: line, careerPath: line, sector: line, pay: line }),
  stretch: z.string().trim().max(300).nullable(),
  dealbreakers: z.array(z.object({ kind: z.enum(DEALBREAKER_KINDS), evidence: line })).max(3),
  salaryFromPosting: z.string().trim().max(200).nullable(),
  confidence: z.enum(["high", "medium", "low"]),
}).strict();
export type EvaluationInput = z.infer<typeof EvaluationInput>;

/** 0–100 from the six parts; the dealbreaker penalty is applied by the ranker so it shows as its own line. */
export function evaluationPoints(s: EvalScores): Record<keyof EvalScores, number> {
  const out = {} as Record<keyof EvalScores, number>;
  for (const k of Object.keys(WEIGHTS) as (keyof EvalScores)[]) {
    const v = s[k] ?? 3;
    out[k] = Math.round(((v - 1) / 4) * WEIGHTS[k] * 10) / 10;
  }
  return out;
}

export function saveEvaluation(raw: unknown, model: string): { jobId: number; result: "inserted" | "replaced" } {
  const e = EvaluationInput.parse(raw);
  const db = getDb();
  const job = db.select({ id: schema.jobs.id, contentHash: schema.jobs.contentHash }).from(schema.jobs).where(eq(schema.jobs.id, e.jobId)).get();
  if (!job) throw new Error(`job ${e.jobId} does not exist`);
  const row = {
    jobId: e.jobId, gradRole: e.gradRole, gradRoleReason: e.gradRoleReason, family: e.family, oneLine: e.oneLine,
    dayToDay: e.dayToDay, scores: e.scores, reasons: e.reasons, stretch: e.stretch, dealbreakers: e.dealbreakers,
    salaryFromPosting: e.salaryFromPosting, confidence: e.confidence, contentHash: job.contentHash, model,
    rubricVersion: RUBRIC_VERSION, evaluatedAt: new Date().toISOString(),
  };
  const existing = db.select({ id: schema.roleEvaluations.id }).from(schema.roleEvaluations).where(eq(schema.roleEvaluations.jobId, e.jobId)).get();
  if (existing) {
    db.update(schema.roleEvaluations).set(row).where(eq(schema.roleEvaluations.id, existing.id)).run();
    return { jobId: e.jobId, result: "replaced" };
  }
  db.insert(schema.roleEvaluations).values(row).run();
  return { jobId: e.jobId, result: "inserted" };
}

export interface BatchJob {
  jobId: number; company: string; title: string; location: string | null; kind: string; deadline: string | null;
  salary: string | null; start: string | null; url: string | null; description: string;
}

/** Kept, active jobs with no evaluation (or one from an older rubric / changed posting), as batch inputs. */
export function jobsToEvaluate(opts: { all?: boolean; ids?: number[] } = {}): BatchJob[] {
  const db = getDb();
  const rows = db.select({
    jobId: schema.jobs.id, company: schema.companies.name, title: schema.jobs.title, location: schema.jobs.locationRaw,
    kind: schema.jobs.kind, deadline: schema.jobs.deadline, salary: schema.jobs.salaryText, start: schema.jobs.startText,
    url: schema.jobs.canonicalUrl, applyUrl: schema.jobs.applyUrl, description: schema.jobs.descriptionText,
    contentHash: schema.jobs.contentHash, excluded: schema.jobs.excludedReason, active: schema.jobs.isActive,
  }).from(schema.jobs).innerJoin(schema.companies, eq(schema.companies.id, schema.jobs.companyId))
    .where(opts.ids ? inArray(schema.jobs.id, opts.ids) : eq(schema.jobs.isActive, true)).all();
  const evals = new Map(db.select({ jobId: schema.roleEvaluations.jobId, v: schema.roleEvaluations.rubricVersion, h: schema.roleEvaluations.contentHash })
    .from(schema.roleEvaluations).all().map((r) => [r.jobId, r]));
  return rows
    .filter((r) => opts.ids || (r.active && !r.excluded))
    .filter((r) => {
      if (opts.all || opts.ids) return true;
      const e = evals.get(r.jobId);
      return !e || e.v !== RUBRIC_VERSION || (!!r.contentHash && e.h !== r.contentHash);
    })
    .map((r) => ({
      jobId: r.jobId, company: r.company, title: r.title, location: r.location, kind: r.kind, deadline: r.deadline,
      salary: r.salary, start: r.start, url: r.url ?? r.applyUrl,
      description: clip(r.description ?? "(no description stored)", 4500),
    }));
}

function clip(s: string, n: number) {
  const t = s.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t.length > n ? `${t.slice(0, n)} …[clipped]` : t;
}
