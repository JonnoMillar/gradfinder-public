/**
 * "Needs you" bar (server component, in the layout): one line per run waiting on a question, linking to its role page
 * where the cards are. Renders nothing when nothing is waiting. Reads only (lib/runs/runs.ts).
 */
import Link from "next/link";
import { needsYou } from "@/lib/runs/runs";

export function NeedsYou() {
  const waiting = needsYou();
  if (!waiting.length) return null;
  return (
    <div className="rn-bar" role="status">
      <div className="wrap">
        <b>Needs you</b>
        {waiting.map((w) => (
          <span key={w.run.id}>
            <Link href={`/jobs/${w.run.jobId}`}>{w.company}</Link>: {w.questions.length} question{w.questions.length === 1 ? "" : "s"}
          </span>
        ))}
      </div>
    </div>
  );
}
