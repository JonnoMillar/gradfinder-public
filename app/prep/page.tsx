/**
 * `/prep` — assessment prep hub index (Jonno 2026-11-04): every role with a prep file, to open from here without asking
 * Claude. Sky is first. A role gets a file when it reaches tests or a HireVue; `lib/prep.ts` says how they are made.
 */
import Link from "next/link";
import { PageSlide } from "@/components/PageSlide";
import { Logo } from "@/components/primitives";
import { IconChevron } from "@/lib/ui/icons";
import { APPLICATION_STATUS_LABEL, daysUntil, fmtDate } from "@/lib/ui/format";
import { listPrep } from "@/lib/prep";

export const dynamic = "force-dynamic";

export default function PrepIndex() {
  const roles = listPrep();
  return (
    <PageSlide>
      <main className="wrap ff pp">
        <header className="pp-head">
          <h1>Assessment prep</h1>
          <p className="pp-sum">Everything for a test or HireVue in one place: the employer&apos;s values, how each stage works, your stories, and a practice timer.</p>
        </header>
        {roles.length ? (
          <ul className="pp-roles">
            {roles.map((r) => {
              const d = daysUntil(r.due);
              return (
                <li key={r.jobId}>
                  <Link className="pp-role" href={`/prep/${r.jobId}`} transitionTypes={["nav-forward"]}>
                    <Logo company={{ name: r.company, logoUrl: r.logoUrl, domain: r.domain }} size={44} />
                    <span className="pp-role-t">
                      <b>{r.company}</b>
                      <span>{r.title}</span>
                    </span>
                    <span className="pp-role-s">
                      <b>{APPLICATION_STATUS_LABEL[r.status ?? ""] ?? r.status ?? "Not tracked"}</b>
                      {r.due ? <span>{r.dueText ? `${r.dueText.replace(/\s*\(.*$/, "")}: ` : "Due "}{fmtDate(r.due)}{d != null ? ` · ${d < 0 ? `${-d}d overdue` : d === 0 ? "today" : `${d}d left`}` : ""}</span> : null}
                    </span>
                    <IconChevron />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="pp-none">No prep files yet. A role gets one when it reaches tests or a HireVue.</p>
        )}
      </main>
    </PageSlide>
  );
}
