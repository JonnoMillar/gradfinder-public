/**
 * Filter and sort controls. Deliberately links, not client state: every view is a URL, so the
 * back button works and a useful filter combination can be bookmarked. No JS needed.
 *
 * One quiet bar (Jonno 2026-09-28: the first page was "quite ugly" with every chip on show): sort, search, London,
 * and a Filters button that opens the rest in a panel. Whatever is switched on shows as a removable chip under the
 * bar, so a narrowed list never hides why it's narrow.
 */
import Link from "next/link";
import { ViewTransition } from "react";
import {
  DEADLINE_WINDOWS, kindLabel, sectorColor, sectorHasHue, sectorLabel,
  APPLICATION_STATUS_LABEL,
} from "@/lib/ui/format";
import { IconFilter, IconPin, IconSearch } from "@/lib/ui/icons";
import type { ListFilters, SortKey } from "@/lib/queries";

type Facets = {
  kinds: { k: string; n: number }[];
  sectors: { k: string; n: number }[];
  statuses: { k: string; n: number }[];
  windows: { week: number; month: number; none: number };
  intakeConfirmed: number;
  london: number;
  excluded: number;
  total: number;
};

/** Query-string pairs for a filter state; shared by the links and the search form's hidden fields. */
function params(f: ListFilters): [string, string][] {
  const p: [string, string][] = [];
  if (f.sort !== "deadline") p.push(["sort", f.sort]);
  if (f.kinds.length) p.push(["kind", f.kinds.join(",")]);
  if (f.sectors.length) p.push(["sector", f.sectors.join(",")]);
  if (f.statuses.length) p.push(["status", f.statuses.join(",")]);
  if (f.window) p.push(["window", f.window]);
  if (f.showExcluded) p.push(["excluded", "1"]);
  if (f.confirmedOnly) p.push(["intake", "2027"]);
  if (f.londonOnly) p.push(["london", "1"]);
  if (f.q) p.push(["q", f.q]);
  return p;
}

/** Rebuilds the query string with one value toggled on or off. */
function href(f: ListFilters, patch: Partial<ListFilters>): string {
  const s = new URLSearchParams(params({ ...f, ...patch })).toString();
  return s ? `/?${s}` : "/";
}

const toggle = (list: string[], v: string) =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

const SORTS: { key: SortKey; label: string }[] = [
  { key: "deadline", label: "Closing soon" },
  { key: "rank", label: "Best match" },
  { key: "newest", label: "Newest" },
];

/** a filter change: the list crossfades to its new contents (the `swap` class in globals.css) */
const SWAP = ["swap"];

const statusLabel = (k: string) => (k === "__none__" ? "Untracked" : (APPLICATION_STATUS_LABEL[k] ?? k));
const sectorName = (k: string) => (k === "__none__" ? "Not researched" : sectorLabel(k));

export function Filters({ f, facets }: { f: ListFilters; facets: Facets }) {
  /** everything behind the Filters button that is switched on, as chips that remove themselves */
  const active: { label: string; to: string }[] = [
    ...(f.window ? [{ label: DEADLINE_WINDOWS.find((w) => w.key === f.window)?.label ?? f.window, to: href(f, { window: null }) }] : []),
    ...(f.confirmedOnly ? [{ label: "2027 confirmed", to: href(f, { confirmedOnly: false }) }] : []),
    ...f.kinds.map((k) => ({ label: kindLabel(k), to: href(f, { kinds: toggle(f.kinds, k) }) })),
    ...f.sectors.map((k) => ({ label: sectorName(k), to: href(f, { sectors: toggle(f.sectors, k) }) })),
    ...f.statuses.map((k) => ({ label: statusLabel(k), to: href(f, { statuses: toggle(f.statuses, k) }) })),
    ...(f.showExcluded ? [{ label: "Showing filtered out", to: href(f, { showExcluded: false }) }] : []),
    ...(f.q ? [{ label: `“${f.q}”`, to: href(f, { q: null }) }] : []),
  ];
  const hidden = params({ ...f, q: null });
  const cur = SORTS.findIndex((s) => s.key === f.sort);

  return (
    <div className="controls">
      <div className="fbar">
        <nav className="seg" aria-label="Sort">
          {SORTS.map((s, i) => {
            const on = f.sort === s.key;
            return (
              <Link key={s.key} href={href(f, { sort: s.key })}
                    transitionTypes={[i > cur ? "sort-next" : "sort-prev"]} scroll={false}
                    className={`seg-b${on ? " seg-b--on" : ""}`}
                    aria-current={on ? "true" : undefined}>
                {/* one thumb, handed from button to button: it glides to the new sort instead of jumping */}
                {on ? <ViewTransition name="seg-thumb" share="thumb" default="none"><span className="seg-thumb" /></ViewTransition> : null}
                <span className="seg-l">{s.label}</span>
              </Link>
            );
          })}
        </nav>

        <form className="find" action="/" method="get" role="search">
          <IconSearch width={14} height={14} />
          <input className="search" type="search" name="q" defaultValue={f.q ?? ""}
                 placeholder="Company or title" aria-label="Search company or title" />
          {hidden.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        </form>

        <Link scroll={false} transitionTypes={SWAP} href={href(f, { londonOnly: !f.londonOnly })}
              className={`tb tb--icon${f.londonOnly ? " tb--on" : ""}`}
              title="Only roles whose posting names London (hides UK-wide, remote and unstated locations)">
          <IconPin width={13} height={13} />London only <b>{facets.london}</b>
        </Link>

        <details className="more-f">
          <summary className={`tb tb--icon${active.length ? " tb--lit" : ""}`}>
            <IconFilter width={14} height={14} />Filters{active.length ? <b>{active.length}</b> : null}
          </summary>
          <div className="fpanel">
            <div className="ctl-row">
              <span className="ctl-label">Closes</span>
              {DEADLINE_WINDOWS.map((w) => (
                <Link scroll={false} transitionTypes={SWAP} key={w.key} href={href(f, { window: f.window === w.key ? null : w.key })}
                      className={`tb${f.window === w.key ? " tb--on" : ""}`}>
                  {w.label} <b>{facets.windows[w.key]}</b>
                </Link>
              ))}
              <Link scroll={false} transitionTypes={SWAP} href={href(f, { confirmedOnly: !f.confirmedOnly })}
                    className={`tb${f.confirmedOnly ? " tb--on" : ""}`}
                    title="Hide roles whose posting never says which intake they are for">
                2027 confirmed <b>{facets.intakeConfirmed}</b>
              </Link>
            </div>
            <div className="ctl-row">
              <span className="ctl-label">Kind</span>
              {facets.kinds.slice(0, 6).map((k) => (
                <Link scroll={false} transitionTypes={SWAP} key={k.k} href={href(f, { kinds: toggle(f.kinds, k.k) })}
                      className={`tb${f.kinds.includes(k.k) ? " tb--on" : ""}`}>
                  {kindLabel(k.k)} <b>{k.n}</b>
                </Link>
              ))}
            </div>
            <div className="ctl-row">
              <span className="ctl-label">Sector</span>
              {facets.sectors.slice(0, 10).map((s) => (
                <Link scroll={false} transitionTypes={SWAP} key={s.k} href={href(f, { sectors: toggle(f.sectors, s.k) })}
                      className={`tb${sectorHasHue(s.k) ? " tb--dot" : ""}${f.sectors.includes(s.k) ? " tb--on" : ""}`}
                      style={{ "--sec": sectorColor(s.k === "__none__" ? null : s.k) } as React.CSSProperties}>
                  {sectorName(s.k)} <b>{s.n}</b>
                </Link>
              ))}
            </div>
            <div className="ctl-row">
              <span className="ctl-label">Status</span>
              {facets.statuses.slice(0, 8).map((s) => (
                <Link scroll={false} transitionTypes={SWAP} key={s.k} href={href(f, { statuses: toggle(f.statuses, s.k) })}
                      className={`tb${f.statuses.includes(s.k) ? " tb--on" : ""}`}>
                  {statusLabel(s.k)} <b>{s.n}</b>
                </Link>
              ))}
              <Link scroll={false} transitionTypes={SWAP} href={href(f, { showExcluded: !f.showExcluded })}
                    className={`tb${f.showExcluded ? " tb--on" : ""}`}>
                Filtered out <b>{facets.excluded}</b>
              </Link>
            </div>
          </div>
        </details>
      </div>

      {active.length ? (
        <div className="fchips" aria-label="Active filters">
          {active.map((a) => (
            <Link scroll={false} transitionTypes={SWAP} key={a.label} href={a.to} className="chip" title={`Remove: ${a.label}`}>
              {a.label}<span aria-hidden="true">×</span>
            </Link>
          ))}
          {active.length > 1 || f.londonOnly ? <Link scroll={false} transitionTypes={SWAP} href={href(f, {
            kinds: [], sectors: [], statuses: [], window: null, showExcluded: false, confirmedOnly: false, londonOnly: false, q: null,
          })} className="chip chip--clear">Clear all</Link> : null}
        </div>
      ) : null}
    </div>
  );
}
