/**
 * Ranking v2: Claude-evaluated roles score 0–100 on the six-part rubric; roles not yet evaluated keep the v1
 * formula offset by −100 so they always sit below. Every term is in the breakdown so the UI can show why.
 */
import { describe, expect, it } from "vitest";
import { scoreJob } from "@/lib/pipeline/rank";
import { evaluationPoints } from "@/lib/evaluate";
import { SECTOR_WEIGHTS } from "@/config/criteria";

const today = new Date("2026-09-20T12:00:00Z");
const base = { sector: null, aiForward: null, deadline: null, eligibility: null, kind: "unknown" as const };
const scores = (s: number, pay: number | null = s) => ({ workFit: s, chance: s, companyType: s, careerPath: s, sector: s, pay });
const evaluated = (s: number, extra: Partial<{ pay: number | null; dealbreakers: { kind: string }[] }> = {}) =>
  ({ scores: scores(s, extra.pay === undefined ? s : extra.pay), dealbreakers: extra.dealbreakers ?? [] });

describe("scoreJob — evaluated by Claude", () => {
  it("maps all-5s to 100 and all-1s to 0", () => {
    expect(scoreJob({ ...base, evaluation: evaluated(5) }, today).score).toBe(100);
    expect(scoreJob({ ...base, evaluation: evaluated(1) }, today).score).toBe(0);
  });
  it("weights the parts 30/20/15/15/10/10", () => {
    expect(evaluationPoints({ workFit: 5, chance: 1, companyType: 1, careerPath: 1, sector: 1, pay: 1 }).workFit).toBe(30);
    expect(evaluationPoints({ workFit: 1, chance: 5, companyType: 1, careerPath: 1, sector: 1, pay: 1 }).chance).toBe(20);
    expect(evaluationPoints(scores(3)).companyType).toBe(7.5);
  });
  it("sport and tech compound: a sports-tech role gets +4 on top of the sector score, sport alone or tech alone gets nothing", () => {
    expect(scoreJob({ ...base, sport: true, tech: true, evaluation: evaluated(3) }, today).breakdown.sport_tech).toBe(4);
    expect(scoreJob({ ...base, sport: true, tech: false, evaluation: evaluated(3) }, today).breakdown.sport_tech).toBeUndefined();
    expect(scoreJob({ ...base, sport: false, tech: true, evaluation: evaluated(3) }, today).breakdown.sport_tech).toBeUndefined();
  });
  it("treats unknown pay as neutral (3), never as a penalty", () => {
    expect(scoreJob({ ...base, evaluation: evaluated(5, { pay: null }) }, today).breakdown.pay).toBe(5);
  });
  it("a dealbreaker sinks the role by 50, visibly", () => {
    const r = scoreJob({ ...base, evaluation: evaluated(5, { dealbreakers: [{ kind: "hours" }] }) }, today);
    expect(r.breakdown.dealbreaker).toBe(-50);
    expect(r.score).toBe(50);
  });
  it("register-interest and a first-class requirement cost points; an unconfirmed intake does not", () => {
    const b = scoreJob({
      ...base, kind: "register_interest", evaluation: evaluated(3),
      eligibility: { degree_class: "1st", subjects: [], visa_sponsorship: "unknown", other: [] },
    }, today).breakdown;
    expect(b).toMatchObject({ register_interest: -5, requires_first: -30 });
    expect(b.intake_unconfirmed).toBeUndefined();
  });
  it("ignores the deadline (v1 double-counted it)", () => {
    const a = scoreJob({ ...base, evaluation: evaluated(4) }, today).score;
    expect(scoreJob({ ...base, deadline: "2026-09-22", evaluation: evaluated(4) }, today).score).toBe(a);
  });
  it("any evaluated role outranks any unevaluated one", () => {
    const worstEvaluated = scoreJob({ ...base, evaluation: evaluated(1, { dealbreakers: [{ kind: "hours" }] }) }, today).score;
    const bestLegacy = scoreJob({ sector: "ai", aiForward: 3, deadline: "2026-09-21", eligibility: null, kind: "graduate_scheme" }, today).score;
    expect(worstEvaluated).toBeGreaterThan(bestLegacy);
  });
});

describe("scoreJob — not evaluated yet (v1 formula, offset −100)", () => {
  it("gives the v1 baseline minus 100 with a full breakdown", () => {
    const r = scoreJob(base, today);
    expect(r.breakdown).toEqual({ not_evaluated: -100, sector_weight: 1, ai_forward: 0, deadline_urgency: 0, eligibility_risk: 0, kind_bonus: 0 });
    expect(r.score).toBe(-99);
  });
  it("still weights sector, ai_forward, deadline, eligibility and kind", () => {
    expect(scoreJob({ ...base, sector: "ai", aiForward: 3 }, today).breakdown).toMatchObject({ sector_weight: SECTOR_WEIGHTS.ai, ai_forward: 6 });
    const at = (d: string) => scoreJob({ ...base, deadline: d }, today).breakdown.deadline_urgency;
    expect([at("2026-12-01"), at("2026-10-15"), at("2026-10-01"), at("2026-09-25"), at("2026-09-19")]).toEqual([0, 1, 2, 3, -2]);
    const elig = { degree_class: "First", subjects: [], visa_sponsorship: "unknown" as const, other: [] };
    expect(scoreJob({ ...base, eligibility: elig }, today).breakdown.eligibility_risk).toBe(-3);
    expect(scoreJob({ ...base, kind: "graduate_scheme" }, today).breakdown.kind_bonus).toBe(2);
  });
});
