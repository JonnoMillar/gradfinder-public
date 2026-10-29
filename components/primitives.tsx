/**
 * Shared display primitives. Server components — no interactivity lives here.
 *
 * The rule these encode: a value always arrives with its provenance, and a missing value renders
 * as a visible "Not stated" rather than an empty slot (docs/design/DECISION.md).
 */
import Link from "next/link";
import { LogoImg } from "./LogoImg";
import {
  daysUntil, deadlineTier, fmtDate, hostOf, initials, logoSrc, sectorColor, sectorHasHue,
  sectorLabel,
} from "@/lib/ui/format";
import type { FactRow } from "@/lib/queries";

export function Logo({ company, size = 30 }: {
  company: { name: string; logoUrl?: string | null; domain?: string | null };
  size?: number;
}) {
  const src = logoSrc(company);
  const style = {
    width: size, height: size, borderRadius: Math.round(size * 0.23), flex: "none",
    objectFit: "contain" as const, background: "var(--surf-2)",
  };
  if (src) return <LogoImg src={src} style={style} text={initials(company.name)} />;
  return (
    <span
      aria-hidden="true"
      style={{
        ...style, display: "grid", placeItems: "center",
        fontSize: Math.round(size * 0.36), fontWeight: 700, color: "var(--ink-2)",
      }}
    >
      {initials(company.name)}
    </span>
  );
}

/** Days-left figure — the spine of the list. `open` when no deadline was published. */
export function DeadlineGutter({ deadline }: { deadline: string | null }) {
  const d = daysUntil(deadline);
  const tier = deadlineTier(deadline);
  return (
    <span className={`gut g-${tier}`}>
      {d === null ? (
        <span className="open">open</span>
      ) : d < 0 ? (
        <><b>{Math.abs(d)}</b><span className="u">d ago</span></>
      ) : d === 0 ? (
        <span className="today">today</span>
      ) : (
        <><b>{d}</b><span className="u">{d === 1 ? "day" : "days"}</span></>
      )}
    </span>
  );
}

/** Three dots filled to the level. Never assessed shows an en dash, not the words. */
export function AiDots({ level }: { level: number | null }) {
  if (level == null) {
    return <span className="ai ai--none" title="AI-forwardness not assessed">–</span>;
  }
  return (
    <span className="ai" title={`AI-forward ${level} of 3`} role="img" aria-label={`AI-forward ${level} of 3`}>
      {[0, 1, 2].map((i) => <i key={i} className={i < level ? "on" : undefined} />)}
    </span>
  );
}

/** Dot always; the word only when it classifies something. "Other" gets a neutral dot alone. */
export function SectorTag({ sector }: { sector: string | null }) {
  return (
    <span className="sec" style={{ "--sec": sectorColor(sector) } as React.CSSProperties}
          title={`Sector: ${sectorLabel(sector)}`}>
      <i />{sectorHasHue(sector) ? sectorLabel(sector) : <span className="sr">{sectorLabel(sector)}</span>}
    </span>
  );
}

export function SourceLink({ url, kind, confidence, inline = true }: {
  url: string; kind?: string; confidence?: string; inline?: boolean;
}) {
  const title = [kind?.replace(/_/g, " "), confidence && `${confidence} confidence`, url]
    .filter(Boolean).join(" · ");
  return (
    <a className={`src${inline ? " src--inline" : ""}`} href={url} target="_blank"
       rel="noreferrer" title={title}>
      {hostOf(url)}
    </a>
  );
}

export const NotStated = ({ where = "the posting" }: { where?: string }) => (
  <span className="nf">Not stated in {where}</span>
);

/** One `facts` row: value, confidence, and the URL it came from. */
export function FactLine({ fact }: { fact: FactRow }) {
  return (
    <div className="fr">
      <span className="f">{fact.field.replace(/_/g, " ")}</span>
      <span className="v">{fact.valueText}</span>
      <span className="s">
        <span className="cnf" data-c={fact.confidence}>{fact.confidence}</span>
        <SourceLink url={fact.sourceUrl} kind={fact.sourceKind} confidence={fact.confidence} inline={false} />
      </span>
    </div>
  );
}

export function NewsList({ items }: {
  items: { title: string; url: string; published_at: string | null; source_name: string | null }[];
}) {
  if (!items.length) return <p className="prose">No news found in the last 30 days.</p>;
  return (
    <ul className="news">
      {items.map((n) => (
        <li key={n.url}>
          <span className="w">{fmtDate(n.published_at?.slice(0, 10)) || "—"}</span>
          <a className="t" href={n.url} target="_blank" rel="noreferrer">
            <span className="t">{n.title}</span>
          </a>
          <span className="s">{n.source_name ?? ""}</span>
        </li>
      ))}
    </ul>
  );
}

export function CompanyLink({ slug, children }: { slug: string; children: React.ReactNode }) {
  return <Link href={`/companies/${slug}`}>{children}</Link>;
}

/**
 * The sport stamp: a solid swallowtail ribbon, set at a slight tilt like a stamp pressed onto the row. It marks a role
 * with anything to do with sport (see `JobListRow.sport`); the word is in the shape, so it needs no key.
 */
export function SportStamp({ title = "Sport: the employer or the role is in sport" }: { title?: string }) {
  return <span className="stamp" title={title} aria-label="Sport">Sport</span>;
}

/** Same stamp as Sport, in blue: first seen in the last two weeks. */
export function NewStamp() {
  return <span className="stamp stamp--new" title="Newly listed: first seen in the last two weeks">New</span>;
}
