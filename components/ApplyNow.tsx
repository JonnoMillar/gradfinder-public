/**
 * Apply now (Jonno 2026-10-27): the priority section under the hero. The roles most worth sending now, from
 * `suggestNext()` (rank score, a close deadline, newly listed, marked Interested; one per company). Do this first and
 * Up next take the first one or two; this is the rest of the queue. A newly listed role wears a New tag; the tile
 * already shows the rest of why it is here (days left, fit ring, status), so no line of reasons (Jonno 2026-10-28).
 */
import { JobRow } from "./JobRow";
import type { Suggestion } from "@/lib/queries";

export function ApplyNow({ rows }: { rows: Suggestion[] }) {
  if (!rows.length) return null;
  return (
    <section className="apn" aria-labelledby="apn-h">
      <div className="apn-h">
        <h2 id="apn-h">Apply now</h2>
      </div>
      <div className="tiles">
        {rows.map((s) => <JobRow key={s.id} job={s} fresh={s.fresh} />)}
      </div>
    </section>
  );
}
