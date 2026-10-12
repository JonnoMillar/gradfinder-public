import Link from "next/link";
import type { SweepSourceRow } from "@/lib/queries";

/**
 * Sources fail loudly (spec §7). This shows the sources whose *most recent* run failed —
 * a source that broke once and has since recovered is not an open problem.
 */
export function FailedSourceBanner({ failing }: { failing: SweepSourceRow[] }) {
  if (!failing.length) return null;
  const first = failing[0];
  return (
    <div className="alert" role="status">
      <div className="wrap alert-in">
        <b>
          {failing.length} source{failing.length > 1 ? "s" : ""} failing:{" "}
          {failing.map((f) => f.source).join(", ")}
        </b>
        <span className="msg">{first.error ?? "no error recorded"}</span>
        <Link href="/sweeps">See the run log</Link>
      </div>
    </div>
  );
}
