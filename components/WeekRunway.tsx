/**
 * The This week band as a timeline (Jonno 2026-09-29: the old cards "didn't visually communicate the days left: the
 * ones closing tomorrow are visually identical and positioned almost the same as the ones closing seven days from
 * now"). Eight day columns, today to a week out; each company sits in the column of its closing day, so position is
 * the deadline. The columns run hot to cool: the nearer the day, the stronger its tint and number.
 *
 * One chip per company per day: logo, name, fit ring, and "5 roles" when several close together (that chip opens the
 * company page, which lists them all; a single role opens the role). No role titles: they cramped the cards.
 * On a phone the columns become rows, and empty days drop out.
 */
import Link from "next/link";
import { Logo } from "./primitives";
import { FitRing } from "./FitRing";
import { daysUntil } from "@/lib/ui/format";
import type { JobListRow } from "@/lib/queries";

const SPAN = 8; // today + 7

function dayLabel(d: number, now: Date): { top: string; date: string } {
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
  const date = t.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
  return { top: d === 0 ? "Today" : d === 1 ? "Tomorrow" : date.split(" ")[0], date: d <= 1 ? date : String(t.getDate()) };
}

export function WeekRunway({ rows }: { rows: JobListRow[] }) {
  const now = new Date();
  const days = Array.from({ length: SPAN }, (_, d) => {
    const on = rows.filter((r) => daysUntil(r.deadline) === d);
    const byCo = new Map<number, JobListRow[]>();
    for (const r of on) { const l = byCo.get(r.companyId); if (l) l.push(r); else byCo.set(r.companyId, [r]); }
    // strongest fit first within a day
    const cos = [...byCo.values()].sort((a, b) => Math.max(...b.map((r) => r.rankScore)) - Math.max(...a.map((r) => r.rankScore)));
    return { d, cos };
  });

  return (
    <ol className="rwy" aria-label="Closing in the next seven days, by day">
      {days.map(({ d, cos }) => {
        const l = dayLabel(d, now);
        return (
          <li key={d} className="rwy-day" data-empty={cos.length ? undefined : "1"}
              style={{ "--heat": Math.max(0, (SPAN - 1 - d) / (SPAN - 1)) } as React.CSSProperties}
              data-t={d <= 3 ? "hot" : "warm"}>
            <span className="rwy-h">
              {d === 0 ? <b className="rwy-today">Today</b> : <b>{d}</b>}
              {d > 0 ? <span>{d === 1 ? "day left" : "days left"}</span> : <span>closes</span>}
              {d > 0 ? <i>{d === 1 ? "Tomorrow" : `${l.top} ${l.date}`}</i> : null}
            </span>
            {cos.map((roles) => {
              const first = roles[0];
              const best = roles.reduce((b, r) => (r.rankScore > b.rankScore ? r : b), first);
              const many = roles.length > 1;
              return (
                <Link key={first.companyId} className="rwy-co" transitionTypes={["nav-forward"]}
                      href={many ? `/companies/${first.companySlug}` : `/jobs/${first.id}`}
                      title={roles.map((r) => r.title).join("\n")}
                      aria-label={many ? `${first.company}: ${roles.length} roles` : `${first.company}: ${first.title}`}>
                  <span className="rwy-top">
                    <Logo company={{ name: first.company, logoUrl: first.logoUrl, domain: first.domain }} size={24} />
                    <FitRing score={best.rankScore} rankPos={best.rankPos} size={30} />
                  </span>
                  <b>{first.company}</b>
                  {many ? <span className="rwy-n">{roles.length} roles</span> : null}
                </Link>
              );
            })}
          </li>
        );
      })}
    </ol>
  );
}
