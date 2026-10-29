/**
 * The right half of the Roles page hero, beside Do this first + Up next (Jonno 2026-09-29, rings labelled 2026-10-02):
 *  1. The week: Apple-style rings, one per kind of task, each with a legend line saying what it counts and how far it
 *     is ("0 / 6 applications sent", "1 / 3 online tests done"), so a ring never has to be guessed. Clicking it opens
 *     the week panel. HireVues and interviews join when they have a stage of their own.
 *  2. In progress: every tracked role with a step waiting on him ("Fill out the application", "Complete the online
 *     test", his own step, or what a recruiter email asked for), with when that step is due on the right. Company only:
 *     the role is on the tile it links to.
 *  3. Last chance: roles worth applying for that close within two days, one row per company.
 *  4. "N more in progress" when the list is cut short, linking to the Applications page.
 */
import Link from "next/link";
import { Logo } from "./primitives";
import { WeekRings } from "./WeekRings";
import type { CloseRole, DoItem, DoNext } from "@/lib/queries";
import type { WeekGoal } from "@/lib/tracker/goals";

/** rows per list: the column has to sit beside the square Up next card; the rest are on the Applications page */
const SHOW = 3;

function Days({ d }: { d: number | null }) {
  if (d === null) return <span className="nx-d" />;
  const t = d < 0 ? "hot" : d <= 3 ? "hot" : d <= 7 ? "warm" : "calm";
  return (
    <span className="nx-d" data-t={t}>
      {d < 0 ? <b>{-d}d late</b> : d === 0 ? <b>Today</b> : <><b>{d}</b> day{d === 1 ? "" : "s"}</>}
    </span>
  );
}

function Step({ it }: { it: DoItem }) {
  return (
    <li>
      <Link href={`/jobs/${it.jobId}`} transitionTypes={["nav-forward"]} className="nx-row">
        <Logo company={{ name: it.company, logoUrl: it.logoUrl, domain: it.domain }} size={28} />
        <span className="nx-who">
          <b>{it.company}</b>
          <span className="nx-step" data-s={it.status} data-auto={it.auto ? "1" : undefined}>{it.step}</span>
        </span>
        <Days d={it.days} />
      </Link>
    </li>
  );
}

function Closing({ r }: { r: CloseRole }) {
  return (
    <li>
      <Link href={`/jobs/${r.jobId}`} transitionTypes={["nav-forward"]} className="nx-row">
        <Logo company={{ name: r.company, logoUrl: r.logoUrl, domain: r.domain }} size={28} />
        <span className="nx-who">
          <b>{r.company}</b>
          {r.n > 1 ? <span>{r.n} roles close</span> : null}
        </span>
        <Days d={r.days} />
      </Link>
    </li>
  );
}

export function WeekGlance({ g, todo, closing, skipJob = null }: {
  g: WeekGoal; todo: DoNext; closing: CloseRole[];
  /** the role Do this first already shows, so it isn't listed twice */
  skipJob?: number | null;
}) {
  const steps = todo.items.filter((it) => it.jobId !== skipJob);

  return (
    <div className="nx">
      <WeekRings g={g} />

      {steps.length ? (
        <section className="nx-sec" aria-labelledby="nx-fin">
          <h2 id="nx-fin">In progress</h2>
          <ul>{steps.slice(0, SHOW).map((it) => <Step key={it.jobId} it={it} />)}</ul>
        </section>
      ) : null}

      {closing.length ? (
        <section className="nx-sec nx-sec--hot" aria-labelledby="nx-last">
          <h2 id="nx-last">Last chance</h2>
          <ul>{closing.slice(0, SHOW).map((r) => <Closing key={r.jobId} r={r} />)}</ul>
        </section>
      ) : null}

      {/* the pipeline tally ("1 applying · 8 waiting to hear") lived here; the Applications tab has it (Jonno 2026-10-28) */}
      {steps.length > SHOW ? (
        <Link href="/applications" transitionTypes={["tab"]} className="nx-all">
          <span>{steps.length - SHOW} more in progress</span>
          <span aria-hidden="true">→</span>
        </Link>
      ) : null}
    </div>
  );
}
