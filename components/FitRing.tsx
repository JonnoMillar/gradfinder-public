/**
 * The fit score out of 100 in a ring whose arc fills to the score. Its colour is a continuous ramp of the score (dull
 * blue-grey → ice blue → near white; app/globals.css .fring), so it reads at a glance with no jumps. The few best fits
 * (platinum, lib/ui/fit.ts) also get a slow sheen.
 */
import { fitScore, fitTier } from "@/lib/ui/fit";

const TIER_WORD = { platinum: "Platinum", gold: "Gold", silver: "Silver", bronze: "Bronze", none: "" } as const;

export function FitRing({ score, size = 44, rankPos }: { score: number; size?: number; rankPos?: number | null }) {
  const n = fitScore(score);
  const tier = fitTier(score);
  const title = n === null
    ? "No fit score yet: not evaluated by Claude, or it has a dealbreaker"
    : `Fit ${n}/100 (${TIER_WORD[tier]})${rankPos ? `, rank ${rankPos} of every kept role` : ""}. Claude's judgement, not a sourced fact`;
  return (
    <span className="fring" data-tier={tier} title={title} role="img" aria-label={title}
          style={{ "--p": n ?? 0, "--s": `${size}px` } as React.CSSProperties}>
      <b>{n ?? "–"}</b>
    </span>
  );
}
