"use client";
/**
 * The header tabs, with the current one marked (Jonno 2026-10-28: "something shows which page you are on"). A role or
 * company page counts as Roles: that is where you came from.
 *
 * News on Applications (Jonno 2026-11-04): when the Gmail sync has moved a role forward and he hasn't watched it play on
 * the Climb yet, a small platinum cube sits on the tab's corner (no number beside it, 2026-11-05; the hover title and
 * screen-reader text give the count), and gives a short shake now and then (three
 * bursts, then it just glints), the way a game's chest asks to be opened. A rejection on its own gets the quiet version:
 * the Climb's dashed outline cube, no shake. Shape says which, not colour. A client navigation never redraws the layout,
 * so the tab asks `/api/news` when it comes back into view and refreshes if the sync has moved something meanwhile.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { cube, faces } from "@/lib/ui/cubes";

const TABS = [
  { href: "/", label: "Roles", match: (p: string) => p === "/" || p.startsWith("/jobs") || p.startsWith("/companies") },
  { href: "/applications", label: "Applications", match: (p: string) => p.startsWith("/applications") },
  { href: "/prep", label: "Prep", match: (p: string) => p.startsWith("/prep") },
  { href: "/kit", label: "Kit", match: (p: string) => p.startsWith("/kit") },
  { href: "/sweeps", label: "Sweeps", match: (p: string) => p.startsWith("/sweeps") },
];

const glyph = faces(7, 0.8, cube(6));

/** forward = moves worth opening; ended = rejections */
export interface News { forward: number; ended: number }

function NewsMark({ news }: { news: News }) {
  const up = news.forward > 0;
  const n = up ? news.forward : news.ended;
  const label = up ? `${n} role${n === 1 ? "" : "s"} moved stage` : `${n} new rejection${n === 1 ? "" : "s"}`;
  return (
    <span className="nb" data-up={up ? "1" : undefined} title={label}>
      <span className="sr">{`, ${label}`}</span>
      <svg viewBox="0 0 14 15" width="14" height="15" aria-hidden="true">
        <polygon points={glyph.left} className="nb-l" />
        <polygon points={glyph.right} className="nb-r" />
        <polygon points={glyph.top} className="nb-t" />
      </svg>
    </span>
  );
}

export function NavLinks({ news }: { news?: News }) {
  const path = usePathname();
  const router = useRouter();
  // coming back to the tab: if the Gmail sync has changed the news since this page was drawn, redraw it (badge, cube)
  const sig = `${news?.forward ?? 0}/${news?.ended ?? 0}`;
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/news", { cache: "no-store" }).then((r) => r.json())
        .then((n: News) => { if (`${n.forward}/${n.ended}` !== sig) router.refresh(); }, () => {});
    };
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, [sig, router]);
  const show = news && (news.forward > 0 || news.ended > 0);
  return (
    <nav className="nav">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} transitionTypes={["tab"]} aria-current={t.match(path) ? "page" : undefined}>
          {t.label}
          {show && t.href === "/applications" ? <NewsMark news={news} /> : null}
        </Link>
      ))}
    </nav>
  );
}
