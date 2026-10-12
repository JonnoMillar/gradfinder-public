/**
 * The fit score out of 100 in a ring whose arc fills to the score, coloured by medal tier (lib/ui/fit.ts): bronze,
 * silver, gold, and platinum for the few best fits, which also carries a slow sheen. The colour is the point: it makes
 * a grid of role tiles read at a glance, and the rare platinum ones stand out.
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
