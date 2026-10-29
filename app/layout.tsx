import type { Metadata } from "next";
import { Instrument_Sans, IBM_Plex_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { WeekPill } from "@/components/WeekPill";
import { Celebrate } from "@/components/Celebrate";
import { NeedsYou } from "@/components/NeedsYou";
import { NavLinks } from "@/components/NavLinks";
import { currentWeekGoal, weekPlan } from "@/lib/queries";

const sans = Instrument_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

/** Mono is used only for identifiers: model names, source URLs, raw adapter errors. */
const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
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
  return (
    <html lang="en-GB" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <header className="top" style={{ viewTransitionName: "site-header" }}>
          <div className="wrap top-in">
            <Link href="/" className="brand">gradfinder</Link>
            {/* demo mode (docs/superpowers/specs/2026-10-12-public-showcase.md): fictional user, so say so on every page */}
            {process.env.NEXT_PUBLIC_DEMO === "1" && <span className="demo-tag" title="A fictional user, Alex Morgan, on real public postings">Demo data</span>}
            <NavLinks />
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
