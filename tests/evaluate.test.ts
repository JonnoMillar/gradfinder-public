/**
 * Claude role evaluation: strict validation, idempotent store, a "no" verdict excludes via the one keep/drop
 * decision, and the rerank uses the rubric.
 */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gradfinder-eval-"));
process.env.DB_PATH = path.join(tmp, "test.db");

const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
const { getDb, getSqlite } = await import("@/lib/db/client");
const { saveEvaluation, jobsToEvaluate } = await import("@/lib/evaluate");
const { refilter } = await import("@/lib/pipeline/refilter");
const { rankAll } = await import("@/lib/pipeline/rank");
const { excludedReason } = await import("@/lib/pipeline/filter");

const db = () => getSqlite();
let grad = 0, helpdesk = 0;

const evaluation = (jobId: number, over: Record<string, unknown> = {}) => ({
  jobId, gradRole: "yes", gradRoleReason: "New-grad programme, no experience required", family: "data_ai",
  oneLine: "Data and AI graduate programme", dayToDay: "Builds reporting tools and small models for business teams, rotating every six months.",
  scores: { workFit: 5, chance: 4, companyType: 4, careerPath: 5, sector: 3, pay: null },
  reasons: { workFit: "Data tools", chance: "Meets 2:1", companyType: "Modern", careerPath: "AI skills", sector: "Neutral", pay: "Not stated" },
  stretch: null, dealbreakers: [], salaryFromPosting: null, confidence: "high", ...over,
});

beforeAll(() => {
  migrate(getDb(), { migrationsFolder: path.resolve("lib/db/migrations") });
  const c = Number(db().prepare("insert into companies (slug, name) values ('acme','Acme')").run().lastInsertRowid);
  const job = (title: string, key: string) =>
    Number(db().prepare("insert into jobs (company_id, title, dedupe_key, location_raw, is_london, description_text) values (?,?,?,?,1,?)")
      .run(c, title, key, "London", `${title} posting text`).lastInsertRowid);
  grad = job("Data & AI Graduate Programme 2027", "g1");
  helpdesk = job("Tech Services Helpdesk", "h1");
});

describe("saveEvaluation", () => {
  it("rejects malformed or out-of-range output instead of storing half a row", () => {
    expect(() => saveEvaluation(evaluation(grad, { scores: { workFit: 6, chance: 4, companyType: 4, careerPath: 5, sector: 3, pay: null } }), "m")).toThrow();
    expect(() => saveEvaluation(evaluation(grad, { extra: "field" }), "m")).toThrow();
    expect(() => saveEvaluation(evaluation(99999), "m")).toThrow(/does not exist/);
  });
  it("stores, then replaces on re-evaluation", () => {
    expect(saveEvaluation(evaluation(grad), "m")).toEqual({ jobId: grad, result: "inserted" });
    expect(saveEvaluation(evaluation(grad, { confidence: "medium" }), "m")).toEqual({ jobId: grad, result: "replaced" });
    expect(db().prepare("select count(*) n from role_evaluations").get()).toEqual({ n: 1 });
  });
  it("lists only kept roles still waiting for an evaluation", () => {
    expect(jobsToEvaluate().map((j) => j.jobId)).toEqual([helpdesk]);
  });
});

describe("verdict and rank", () => {
  it("a 'no' verdict excludes through excludedReason, with Claude's reason", () => {
    saveEvaluation(evaluation(helpdesk, { gradRole: "no", gradRoleReason: "IT helpdesk support post, not a graduate career role" }), "m");
    refilter([grad, helpdesk]);
    const r = db().prepare("select excluded_reason r from jobs where id = ?").get(helpdesk) as { r: string };
    expect(r.r).toBe("claude_not_grad:IT helpdesk support post, not a graduate career role");
    expect((db().prepare("select excluded_reason r from jobs where id = ?").get(grad) as { r: string | null }).r).toBeNull();
  });
  it("'unsure' keeps the role", () => {
    expect(excludedReason({ title: "Analyst", locationRaw: "London", gradRole: { verdict: "unsure", reason: "thin posting" } })).toBeNull();
  });
  it("rerank scores the evaluated role on the rubric", () => {
    rankAll();
    const row = db().prepare("select rank_score s, rank_breakdown b from jobs where id = ?").get(grad) as { s: number; b: string };
    expect(JSON.parse(row.b)).toMatchObject({ work_fit: 30, chance: 15, pay: 5 });
    expect(row.s).toBeGreaterThan(0);
  });
});
