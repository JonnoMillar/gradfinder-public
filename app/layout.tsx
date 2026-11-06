import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import "./globals.css";
import { WeekPill } from "@/components/WeekPill";
import { Celebrate } from "@/components/Celebrate";
import { NeedsYou } from "@/components/NeedsYou";
import { NavLinks } from "@/components/NavLinks";
import { currentWeekGoal, unseenMoves, weekPlan } from "@/lib/queries";

/** Self-hosted (app/fonts, SIL OFL, from @fontsource): next/font/google fetched at dev start and fell back to the system font offline. */
const sans = localFont({
  variable: "--font-sans",
  src: [
    { path: "./fonts/instrument-sans-latin-400-normal.woff2", weight: "400" },
    { path: "./fonts/instrument-sans-latin-500-normal.woff2", weight: "500" },
    { path: "./fonts/instrument-sans-latin-600-normal.woff2", weight: "600" },
    { path: "./fonts/instrument-sans-latin-700-normal.woff2", weight: "700" },
  ],
  display: "swap",
});

/** Mono is used only for identifiers: model names, source URLs, raw adapter errors. */
const mono = localFont({
  variable: "--font-mono",
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500" },
  ],
  display: "swap",
});

export const metadata: Metadata = {
  title: "gradfinder",
  description: "London 2027 grad roles, sourced and tracked.",
};

/** The week's numbers are read on every request: a stage move revalidates, and the pill must show it at once. */
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const g = currentWeekGoal();
  const plan = weekPlan(g.target - g.sent);
  const moves = unseenMoves();
  const ended = moves.filter((m) => m.to === "rejected").length;
  return (
    <html lang="en-GB" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <header className="top" style={{ viewTransitionName: "site-header" }}>
          <div className="wrap top-in">
            <Link href="/" className="brand">
              {/* app/icon.svg inlined so CSS can animate it: tile pops, G draws, handle extends; hover = magnifier scan */}
              <svg className="gmark" viewBox="0 0 32 32" width={24} height={24} aria-hidden="true">
                <rect className="gmark-tile" width="32" height="32" rx="7" fill="#000" />
                <g className="gmark-lens" fill="none" stroke="#fff" strokeWidth="3.5">
                  <path className="gmark-g" pathLength={1} d="M18.6 9.4A6.5 6.5 0 1 0 20.5 14H14" />
                  <path className="gmark-h" pathLength={1} d="M19 19l6.5 6.5" strokeLinecap="round" />
                </g>
              </svg>
              gradfinder
            </Link>
            {/* demo mode (docs/superpowers/specs/2026-10-12-public-showcase.md): fictional user, so say so on every page */}
            {process.env.NEXT_PUBLIC_DEMO === "1" && <span className="demo-tag" title="A fictional user, Alex Morgan, on real public postings">Demo data</span>}
            <NavLinks news={{ forward: moves.length - ended, ended }} />
            <span className="spacer" />
            <WeekPill g={g} plan={plan} />
          </div>
        </header>
        <NeedsYou />
        {children}
        <Celebrate />
      </body>
    </html>
  );
}
