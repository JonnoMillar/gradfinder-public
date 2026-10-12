/**
 * Visual building blocks for the role page (v2 step 3, redesign 2026-09-25). Server components only.
 *
 * Rules the pieces keep: a sourced claim always carries its source link (the verbatim quote rides in the link's
 * tooltip and in the page's "Sources & quotes" drawer, so the cards stay short); anything that is Claude's judgement
 * (fit, career path, scores) carries the `Judgement` badge; colour never carries meaning on its own — every status
 * also has a word.
 */
import type { CareerPath, CareerStep, FitLine } from "@/lib/db/schema";
import type { CommuteRow, GlanceFact, ResearchClaim } from "@/lib/queries";
import { SourceLink } from "@/components/primitives";
import { fmtDate } from "@/lib/ui/format";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);
const human = (k: string) => k.replace(/^stage_\d+_?/, "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())
  .replace(/\b(ai|ml|cfab|llm)\b/gi, (w) => w.toUpperCase());

export const Judgement = ({ what = "Claude's read" }: { what?: string }) => (
  <span className="judg" title="Claude's judgement from the posting, the research and your knowledge store: not a sourced fact">{what}</span>
);

/** A source link whose tooltip is the sentence the claim was taken from. */
function Src({ c }: { c: ResearchClaim }) {
  return (
    <span className="src-w" title={c.quote ? `“${c.quote}”` : undefined}>
      <SourceLink url={c.sourceUrl} kind={c.sourceKind} confidence={c.confidence} inline={false} />
      {c.confidence !== "high" ? <span className="cnf" data-c={c.confidence}>{c.confidence}</span> : null}
      {c.sourceKind === "reviews" || c.sourceKind === "search_snippet"
        ? <span className="cl-tag">{c.sourceKind === "reviews" ? "reviews" : "snippet"}</span> : null}
    </span>
  );
}

/** Sourced claims as a grid of short cards: label, one or two sentences, source. */
export function ClaimCards({ claims, cols = "auto" }: { claims: ResearchClaim[]; cols?: "auto" | "one" }) {
  if (!claims.length) return null;
  return (
    <div className={`cc${cols === "one" ? " cc--one" : ""}`}>
      {claims.map((c, i) => (
        <div key={`${c.key}-${i}`} className="cc-i">
          <span className="cc-k">{human(c.key)}</span>
          <p className="cc-t">{c.publishedAt ? <span className="cc-d">{fmtDate(c.publishedAt)} · </span> : null}{c.text}</p>
          <Src c={c} />
        </div>
      ))}
    </div>
  );
}

// ---------- key facts strip ----------

export interface KeyFact { label: string; value: React.ReactNode; sub?: React.ReactNode; tone: string; icon: React.ReactNode }

export function KeyFacts({ facts }: { facts: KeyFact[] }) {
  return (
    <dl className="kf">
      {facts.map((f) => (
        <div key={f.label} className="kf-i" data-tone={f.tone}>
          <span className="kf-ic">{f.icon}</span>
          <dt>{f.label}</dt>
          <dd>{f.value}</dd>
          {f.sub ? <dd className="kf-sub">{f.sub}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

// ---------- fit ----------

const FIT_WORD: Record<FitLine["status"], string> = { meets: "Meets", stretch: "Stretch", gap: "Gap", unconfirmed: "Unconfirmed" };
const FIT_ORDER: FitLine["status"][] = ["meets", "stretch", "unconfirmed", "gap"];

export function FitMeter({ fit }: { fit: FitLine[] }) {
  const n = (s: FitLine["status"]) => fit.filter((f) => f.status === s).length;
  return (
    <div className="fm" role="img" aria-label={FIT_ORDER.map((s) => `${n(s)} ${FIT_WORD[s].toLowerCase()}`).join(", ")}>
      <div className="fm-bar">
        {FIT_ORDER.flatMap((s) => Array.from({ length: n(s) }, (_, i) => <i key={`${s}${i}`} data-s={s} />))}
      </div>
      <div className="fm-legend">
        {FIT_ORDER.filter((s) => n(s)).map((s) => <span key={s} data-s={s}><b>{n(s)}</b> {FIT_WORD[s].toLowerCase()}</span>)}
      </div>
    </div>
  );
}

export function FitList({ fit }: { fit: FitLine[] }) {
  const sorted = [...fit].sort((a, b) => FIT_ORDER.indexOf(a.status) - FIT_ORDER.indexOf(b.status));
  return (
    <ul className="fit">
      {sorted.map((f, i) => (
        <li key={i}>
          <span className="fit-s" data-s={f.status}>{FIT_WORD[f.status]}</span>
          <span className="fit-r">{f.requirement}</span>
          <span className="fit-e">{f.evidence}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------- career path flow chart ----------

function payText(s: CareerStep) {
  return s.payLow === s.payHigh ? `£${s.payLow}k` : `£${s.payLow}–${s.payHigh}k`;
}

function Node({ s, max, start }: { s: CareerStep; max: number; start?: boolean }) {
  const l = (s.payLow / max) * 100, w = Math.max(3, ((s.payHigh - s.payLow) / max) * 100);
  return (
    <div className={`cf-n${start ? " cf-n--start" : ""}`}>
      <span className="cf-y">Yr {s.years}</span>
      <b className="cf-t">{s.title}</b>
      <span className="cf-p">{payText(s)}</span>
      <span className="cf-pb" aria-hidden><i style={{ left: `${l}%`, width: `${w}%` }} /></span>
      {s.note ? <span className="cf-note">{s.note}</span> : null}
    </div>
  );
}

/**
 * Where the role could lead: one start node branching into 2–4 tracks, Levels.fyi-style pay bars on a shared
 * £ scale so progression reads at a glance. Claude's rough estimate (Jonno asked for "a rough idea").
 */
export function CareerFlow({ path }: { path: CareerPath }) {
  const all = [path.start, ...path.tracks.flatMap((t) => t.steps)];
  const max = Math.ceil(Math.max(...all.map((s) => s.payHigh)) / 20) * 20;
  const cols = Math.max(...path.tracks.map((t) => t.steps.length));
  return (
    <figure className="cf" style={{ "--cols": cols } as React.CSSProperties}>
      <div className="cf-grid" style={{ gridTemplateRows: `repeat(${path.tracks.length}, auto)` }}>
        <div className="cf-start" style={{ gridRow: `1 / span ${path.tracks.length}` }}>
          <Node s={path.start} max={max} start />
        </div>
        {path.tracks.map((t, r) => (
          <div key={t.name} className={`cf-row${r === 0 ? " first" : ""}${r === path.tracks.length - 1 ? " last" : ""}`}
               style={{ gridRow: r + 1 }} data-t={r}>
            <div className="cf-track"><b>{t.name}</b><span>{t.why}</span></div>
            {t.steps.map((s, i) => <Node key={i} s={s} max={max} />)}
          </div>
        ))}
      </div>
      <figcaption className="cf-cap">
        Bars share one scale, £0–{max}k base pay. <Judgement what="Rough estimate" /> {path.basis}
      </figcaption>
    </figure>
  );
}

// ---------- process timeline ----------

export interface TimelineItem { when?: string | null; title: string; text?: string; claim?: ResearchClaim; tone?: "hot" | "go" }

export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="tl">
      {items.map((it, i) => (
        <li key={i} data-tone={it.tone}>
          <span className="tl-dot" aria-hidden />
          <div className="tl-b">
            <div className="tl-h">
              <b>{it.title}</b>
              {it.when ? <span className="tl-when">{it.when}</span> : null}
            </div>
            {it.text ? <p>{it.text}</p> : null}
            {it.claim ? <Src c={it.claim} /> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ---------- company ----------

export function GlanceTiles({ tiles }: { tiles: { label: string; value: React.ReactNode; fact?: GlanceFact }[] }) {
  if (!tiles.length) return null;
  return (
    <div className="gt">
      {tiles.map((t) => (
        <div key={t.label} className="gt-i">
          <span className="gt-k">{t.label}</span>
          <span className="gt-v">{t.value}</span>
          {t.fact ? <SourceLink url={t.fact.sourceUrl} kind={t.fact.sourceKind} confidence={t.fact.confidence} inline={false} /> : null}
        </div>
      ))}
    </div>
  );
}

/** Automated search-snippet findings: low-confidence by nature, shown small and labelled. */
export function Snippets({ items }: { items: { label: string; fact: GlanceFact }[] }) {
  if (!items.length) return null;
  return (
    <div className="sn">
      {items.map((s, i) => (
        <div key={i} className="sn-i">
          <span className="sn-k">{s.label}</span>
          <span className="sn-v">{clip(s.fact.value, 160)}</span>
          <SourceLink url={s.fact.sourceUrl} kind={s.fact.sourceKind} confidence={s.fact.confidence} inline={false} />
        </div>
      ))}
    </div>
  );
}

export function NewsTimeline({ claims }: { claims: ResearchClaim[] }) {
  if (!claims.length) return null;
  const sorted = [...claims].sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  return (
    <ul className="nt">
      {sorted.map((c, i) => (
        <li key={i}>
          <span className="nt-d">{c.publishedAt ? fmtDate(c.publishedAt) : "—"}</span>
          <div><p>{c.text}</p><Src c={c} /></div>
        </li>
      ))}
    </ul>
  );
}

/** TfL's leg list, shortened to the rides: "SWR → Waterloo · Jubilee line → Canary Wharf". */
export function shortRoute(summary: string) {
  return summary.split(" · ")
    .filter((l) => !l.startsWith("walking:"))
    .map((l) => l.replace(/^[a-z-]+: /, "").replace("South Western Railway", "SWR").replace(/ to (London )?/, " → "))
    .join(" · ");
}

export function CommuteBars({ commutes }: { commutes: CommuteRow[] }) {
  if (!commutes.length) return null;
  const tone = (m: number) => (m <= 35 ? "fast" : m <= 50 ? "ok" : "slow");
  return (
    <ul className="cm">
      {commutes.map((c) => (
        <li key={c.from} data-tone={tone(c.minutes)}>
          <span className="cm-from">{c.from}</span>
          <span className="cm-bar" aria-hidden><i style={{ width: `${Math.min(100, (c.minutes / 75) * 100)}%` }} /></span>
          <b>{c.minutes}<small> min</small></b>
          <span className="cm-r">{shortRoute(c.summary)}</span>
          <SourceLink url={c.sourceUrl} kind={`TfL journey planner, departing ${c.departs}`} inline={false} />
        </li>
      ))}
    </ul>
  );
}

// ---------- scores ----------

export function ScoreBars({ rows }: { rows: { label: string; score: number | null; reason: string; weight: number }[] }) {
  return (
    <div className="sb">
      {rows.map((r) => (
        <div key={r.label} className="sb-i">
          <div className="sb-h">
            <span>{r.label} <small>×{r.weight}</small></span>
            <span className="sb-pips" role="img" aria-label={`${r.score ?? "unknown"} of 5`}>
              {[1, 2, 3, 4, 5].map((n) => <i key={n} className={r.score != null && n <= r.score ? "on" : undefined} />)}
            </span>
          </div>
          <p>{r.reason}</p>
        </div>
      ))}
    </div>
  );
}

// ---------- sources drawer ----------

export function SourcesDrawer({ claims, label }: { claims: ResearchClaim[]; label: string }) {
  if (!claims.length) return null;
  return (
    <details className="disc">
      <summary>{label}<span className="cnt">{claims.length} claims</span></summary>
      <div className="dbody">
        <ul className="sq">
          {claims.map((c, i) => (
            <li key={i}>
              <span className="sq-s">{c.section} · {human(c.key)}</span>
              <span className="sq-t">{c.text}</span>
              {c.quote ? <q className="sq-q">{c.quote}</q> : <span className="sq-q nf">No quote: {c.sourceKind === "search_snippet" ? "seen in search results only" : "not recorded"}</span>}
              <SourceLink url={c.sourceUrl} kind={c.sourceKind} confidence={c.confidence} inline={false} />
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
