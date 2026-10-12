/**
 * The fit score shown on every role (Jonno 2026-09-29: "score out of 100 … colour scoring in a circle … the best
 * close to platinum so it feels special"). The score is the rank score (lib/pipeline/rank.ts), Claude's judgement of
 * fit, clamped to 0–100. Tiers are medals, so the scale reads without a legend: bronze, silver, gold, platinum.
 *
 * Cut-offs from the kept list on 2026-09-29 (309 roles): platinum ≥ 75 is the top ~10 roles, gold 60–74 ~35,
 * silver 45–59 ~80, bronze the rest. Platinum has to stay rare to stay special, so revisit these if it stops being.
 * A negative score means not evaluated yet, or a dealbreaker: no medal, just a dash.
 */

export type FitTier = "platinum" | "gold" | "silver" | "bronze" | "none";

export const FIT_TIERS = { platinum: 75, gold: 60, silver: 45 } as const;

export function fitTier(score: number): FitTier {
  if (score < 0) return "none";
  if (score >= FIT_TIERS.platinum) return "platinum";
  if (score >= FIT_TIERS.gold) return "gold";
  if (score >= FIT_TIERS.silver) return "silver";
  return "bronze";
}

/** the number in the ring: whole points, 0–100; null when there is no score to show */
export function fitScore(score: number): number | null {
  return score < 0 ? null : Math.min(100, Math.round(score));
}
