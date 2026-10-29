"use client";

/** The week's rings with their legend, as one button that opens the week panel. */
import { Rings, Rolling, weekRings } from "./Rings";
import type { WeekGoal } from "@/lib/tracker/goals";

const RING_DOT: Record<string, string> = { send: "var(--mint)", tests: "oklch(0.79 0.12 245)", video: "oklch(0.74 0.15 300)" };
const RING_WORDS: Record<string, string> = { send: "applications sent", tests: "online assessments done", video: "HireVues done" };

export function WeekRings({ g }: { g: WeekGoal }) {
  const done = g.sent >= g.target;
  const rings = weekRings(g);
  return (
    <button type="button" className="nx-week" popoverTarget="week-panel" data-done={done ? "1" : undefined}
            aria-label={`This week's targets: ${g.sent} of ${g.target} applications sent. Open the weekly goals`}>
      <Rings rings={rings} size={96} from={{ send: 0, tests: 0, video: 0 }} burst={false} className="nx-rings" />
      <span className="nx-legend">
        <span className="nx-cap">This week&apos;s targets</span>
        {rings.map((r) => {
          const waiting = r.key === "tests" ? g.tests : r.key === "video" ? g.hirevues : 0;
          return (
            <span key={r.key} className="nx-lg" style={{ ["--rc" as string]: RING_DOT[r.key] }}>
              <i aria-hidden="true" />
              {r.key === "send"
                ? <b><Rolling value={r.value} from={0} /><span>/ {r.target}</span></b>
                : <b>{r.value}<span>/ {r.target}</span></b>}
              <span>{RING_WORDS[r.key]}{waiting ? <em className="nx-wait">{waiting} waiting</em> : null}</span>
            </span>
          );
        })}
      </span>
    </button>
  );
}
