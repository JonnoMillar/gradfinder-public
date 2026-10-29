/**
 * `/` — the list. Deadline bands are the layout; days-left is the spine.
 *
 * Bands render a preview and expand on demand. That is the design (the mock showed a handful per
 * band behind "Show all N"), and it is also what keeps the page quick: rendering several hundred
 * rows at once costs seconds in dev, and nobody reads 300 rows in one pass anyway.
 */
import Link from "next/link";
import { ViewTransition } from "react";
import { CompanyStack } from "@/components/CompanyStack";
import { Filters } from "@/components/Filters";
import { FailedSourceBanner } from "@/components/FailedSourceBanner";
import { JobRow } from "@/components/JobRow";
import { SuggestCard } from "@/components/SuggestCard";
import { ActionCard } from "@/components/ActionCard";
import { ApplyNow } from "@/components/ApplyNow";
import { UndoToast } from "@/components/StageTrack";
import { attention } from "@/lib/tracker/attention";
import { WeekGlance } from "@/components/WeekGlance";
import { WeekRunway } from "@/components/WeekRunway";
import { PageSlide } from "@/components/PageSlide";
import { daysUntil } from "@/lib/ui/format";
import {
  DEFAULT_FILTERS, currentWeekGoal, failingSources, listApplications, listEmailUpdates, listFacets, lastChance,
  listJobs, doNext, suggestNext,
  type JobListRow, type ListFilters, type SortKey,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * Cards (a role, or one company's deck) shown per band before "View all". The home page is a curated view, not the
 * database (design review 2026-09-29): two rows for what closes this week, one row for the rest.
 */
const PREVIEW: Record<string, number> = {};
const PREVIEW_REST = 3;
const FLAT_PREVIEW = 9;
/** the apply queue: Do this first (when nothing is dated) + Up next, then this many tiles in the Apply now section */
const APPLY_QUEUE = 8;
const APPLY_SHOWN = 6;

const csv = (v: string | undefined) => (v ? v.split(",").filter(Boolean) : []);

function parseFilters(sp: Record<string, string | string[] | undefined>): ListFilters {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) as string | undefined;
  const sort = one("sort");
  return {
    ...DEFAULT_FILTERS,
    sort: (["deadline", "rank", "newest"] as const).includes(sort as SortKey)
      ? (sort as SortKey) : "deadline",
    kinds: csv(one("kind")),
    sectors: csv(one("sector")),
    statuses: csv(one("status")),
    window: one("window") ?? null,
    showExcluded: one("excluded") === "1",
    confirmedOnly: one("intake") === "2027",
    londonOnly: one("london") === "1",
    q: one("q")?.trim() || null,
  };
}

/** The current URL with one param replaced (or removed when `value` is null). Keeps filters, band and skip. */
function withParam(sp: Record<string, string | string[] | undefined>, key: string, value: string | null): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === key) continue;
    const val = Array.isArray(v) ? v[0] : v;
    if (val) p.set(k, val);
  }
  if (value) p.set(key, value);
  const s = p.toString();
  return s ? `/?${s}` : "/";
}
const expandHref = (sp: Record<string, string | string[] | undefined>, band: string | null) => withParam(sp, "band", band);

const BANDS = [
  { key: "hot", title: "This week", lo: 0, hi: 7 },
  { key: "mid", title: "This month", lo: 8, hi: 30 },
  { key: "cool", title: "Later", lo: 31, hi: Infinity },
] as const;

/**
 * Roles at the same company, gathered into one deck at the position of the first of them, so the list keeps its
 * order (deadline or rank) and each company takes one card's worth of space.
 */
function decks(rows: JobListRow[]): JobListRow[][] {
  const by = new Map<number, JobListRow[]>();
  for (const r of rows) {
    const d = by.get(r.companyId);
    if (d) d.push(r); else by.set(r.companyId, [r]);
  }
  return [...by.values()];
}

function Cards({ rows }: { rows: JobListRow[][] }) {
  return (
    <div className="tiles">
      {rows.map((d) => d.length === 1
        ? <JobRow key={d[0].id} job={d[0]} />
        : <CompanyStack key={`c${d[0].companyId}`} company={d[0].company} cards={d.map((j) => <JobRow key={j.id} job={j} />)} />)}
    </div>
  );
}

function Band({ id, title, rows, expanded, sp, compact = false }: {
  id: string; title: string; rows: JobListRow[]; expanded: boolean; compact?: boolean;
  sp: Record<string, string | string[] | undefined>;
}) {
  if (!rows.length) return null;
  const all = decks(rows);
  const preview = compact ? Infinity : PREVIEW[id] ?? PREVIEW_REST;
  const shown = expanded ? all : all.slice(0, preview);
  return (
    <section className="band" id={id}>
      <div className={`bh bh-${id}`}>
        <h2>{title}</h2><span className="n">{rows.length}</span><span className="rule" />
      </div>
      {compact ? <WeekRunway rows={rows} /> : <Cards rows={shown} />}
      {all.length > shown.length ? (
        <p className="more">
          <Link href={`${expandHref(sp, id)}#${id}`} scroll={false}>
            View all {rows.length} →
          </Link>
        </p>
      ) : expanded && all.length > preview ? (
        <p className="more"><Link href={`${expandHref(sp, null)}#${id}`} scroll={false}>Collapse this band</Link></p>
      ) : null}
    </section>
  );
}

export default async function Home({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const f = parseFilters(sp);
  const openBand = (Array.isArray(sp.band) ? sp.band[0] : sp.band) ?? null;

  const jobs = listJobs(f);
  const facets = listFacets(f);
  const failing = failingSources();
  const week = currentWeekGoal();
  const skip = csv(Array.isArray(sp.skip) ? sp.skip[0] : sp.skip).map(Number).filter(Number.isInteger);
  // the most urgent dated thing on any tracked role (a test, a HireVue, his own step, a closing date): Do this first
  const { items: due } = attention(listApplications(), listEmailUpdates());
  // Nothing dated: Do this first finishes a role he already started, else takes the head of the apply queue. Up next is
  // the next one, and the Apply now section below the hero lists the rest.
  const finish = due.length ? undefined : doNext(null).items.find((it) => it.status === "applying" && (it.days === null || it.days >= 0));   // a lapsed deadline is a call on /applications, not a task
  const queue = suggestNext(skip, APPLY_QUEUE);
  const start = due.length || finish ? undefined : queue.shift();
  const pick = queue.shift();
  const applyNow = queue.slice(0, APPLY_SHOWN);
  const todo = doNext(pick?.id ?? null);
  const closing = lastChance(pick?.id ?? null);

  const timeOrdered = f.sort === "deadline";
  const flat = decks(jobs);
  const flatShown = openBand === "all" ? flat : flat.slice(0, FLAT_PREVIEW);
  /** the list's identity: a new sort or filter swaps it (slide or crossfade), a band expanding or a skip does not */
  const listKey = JSON.stringify({ ...f, limit: undefined });

  return (
    <PageSlide>
      <FailedSourceBanner failing={failing} />
      <main className="wrap">
        <h1 className="sr">Roles</h1>
        <div className="hero">
          <div className="hero-l">
            <ActionCard items={due} finish={finish} start={start} />
            <SuggestCard pick={pick} skip={skip}
              skipHref={(ids) => withParam(sp, "skip", ids.length ? ids.join(",") : null)} />
          </div>
          <WeekGlance g={week} todo={todo} closing={closing} skipJob={due[0]?.jobId ?? finish?.jobId ?? null} />
        </div>

        <ApplyNow rows={applyNow} />

        <div className="lead">
          <h2>
            {timeOrdered ? "What closes soonest"
              : f.sort === "rank" ? "Best matches first" : "Newest first"}
          </h2>
        </div>

        <Filters f={f} facets={facets} />

        <ViewTransition key={listKey} default="none"
          enter={{ "sort-next": "list-from-right", "sort-prev": "list-from-left", swap: "list-in", default: "none" }}
          exit={{ "sort-next": "list-to-left", "sort-prev": "list-to-right", swap: "list-out", default: "none" }}>
          <div className="list">
            {jobs.length === 0 ? (
              <p className="empty">
                <b>Nothing matches those filters.</b>
                {facets.excluded > 0 && !f.showExcluded
                  ? "There are roles the rules filtered out. Switch on “Filtered out” to see them, or clear the filters."
                  : "Clear the filters and start again."}
              </p>
            ) : timeOrdered ? (
              <>
                {BANDS.map((b) => (
                  <Band
                    key={b.key} id={b.key} title={b.title} sp={sp} expanded={openBand === b.key}
                    compact={b.key === "hot"}
                    rows={jobs.filter((j) => {
                      const d = daysUntil(j.deadline);
                      return d !== null && d >= b.lo && d <= b.hi;
                    })}
                  />
                ))}
                <Band
                  id="past" title="Deadline passed" sp={sp} expanded={openBand === "past"}
                  rows={jobs.filter((j) => j.deadline !== null && (daysUntil(j.deadline) ?? 0) < 0)}
                />
                <Band
                  id="open" title="No deadline published" sp={sp} expanded={openBand === "open"}
                  rows={jobs.filter((j) => j.deadline === null)}
                />
              </>
            ) : (
              <section className="band">
                <div className="bh bh-open">
                  <h2>{jobs.length} role{jobs.length === 1 ? "" : "s"}</h2><span className="rule" />
                </div>
                <Cards rows={flatShown} />
                {flat.length > flatShown.length ? (
                  <p className="more">
                    <Link href={expandHref(sp, "all")} scroll={false}>Show all {jobs.length}</Link>
                  </p>
                ) : null}
              </section>
            )}

            {jobs.length >= f.limit ? (
              <p className="more">
                Showing the first {f.limit} matches. Narrow the filters to see the rest.
              </p>
            ) : null}
          </div>
        </ViewTransition>
        <UndoToast />
      </main>
    </PageSlide>
  );
}
