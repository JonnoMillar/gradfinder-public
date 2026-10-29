"use client";
/**
 * The header tabs, with the current one marked (Jonno 2026-10-28: "something shows which page you are on"). A role or
 * company page counts as Roles: that is where you came from.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Roles", match: (p: string) => p === "/" || p.startsWith("/jobs") || p.startsWith("/companies") },
  { href: "/applications", label: "Applications", match: (p: string) => p.startsWith("/applications") },
  { href: "/kit", label: "Kit", match: (p: string) => p.startsWith("/kit") },
  { href: "/sweeps", label: "Sweeps", match: (p: string) => p.startsWith("/sweeps") },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="nav">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} transitionTypes={["tab"]} aria-current={t.match(path) ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
