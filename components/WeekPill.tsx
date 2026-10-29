"use client";

/**
 * "This week": one small pill in the top bar (mini rings + "1 of 6"), and a panel it opens with the rings, the
 * streak, the plan that fills the ring, and the next milestone. Out of the way until asked for (Jonno 2026-09-28:
 * don't clutter the page), always one click from anywhere.
 *
 * The panel is a native popover: light-dismiss, Esc and focus return for free, and it sits in the top layer so
 * nothing clips it. Numbers come from the server (lib/tracker/goals.ts); after any stage move the page revalidates,
 * the props change, and the rings sweep to the new values. On first load the rings replay from the numbers this
 * browser saw last, so progress made elsewhere (the Gmail sync) still gets its moment.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Rings, Rolling, weekRings } from "./Rings";
import { Logo } from "./primitives";
import { StartButton } from "./StartButton";
import { readSeen, weekStore, writeSeen } from "./motion";
import { HIREVUES_PER_WEEK, TESTS_PER_WEEK, type WeekGoal } from "@/lib/tracker/goals";
import type { PlanItem } from "@/lib/queries";

const fmt = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export function WeekPill({ g, plan }: { g: WeekGoal; plan: PlanItem[] }) {
  const [from, setFrom] = useState<{ send: number; line: number; total: number } | null>(null);
  /** bumps on every open, so the panel's rings sweep up from zero each time it is opened (as Apple's do) */
  const [opened, setOpened] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const h = (e: Event) => { if ((e as ToggleEvent).newState === "open") setOpened((n) => n + 1); };
    el.addEventListener("toggle", h);
    return () => el.removeEventListener("toggle", h);
  }, []);
  const zero = { send: 0, tests: 0, video: 0 };
  // the Roles page shows the week in its hero, so the pill would only repeat it there (the panel stays: the hero opens it)
  const home = usePathname() === "/";

  useEffect(() => {
    const seen = readSeen();
    if (seen && seen.weekStart === g.weekStart && (seen.sent !== g.sent || seen.linedUp !== g.linedUp)) {
      setFrom({ send: seen.sent, line: seen.linedUp, total: seen.sentTotal });
    }
    writeSeen({ weekStart: g.weekStart, sent: g.sent, linedUp: g.linedUp, sentTotal: g.sentTotal });
    weekStore.set({ sent: g.sent, target: g.target, linedUp: g.linedUp, sentTotal: g.sentTotal, streak: g.streak.weeks });
  }, [g.weekStart, g.sent, g.linedUp, g.sentTotal, g.target, g.streak.weeks]);

  const left = Math.max(0, g.target - g.sent);
  const done = g.sent >= g.target;
  const why = [
    `${g.base} a week`,
    g.load ? `${g.load} fewer while ${[(g.tests + g.hirevues) && `${g.tests + g.hirevues} at tests or HireVue`, g.interviews && `${g.interviews} at interview`].filter(Boolean).join(" and ")}` : null,
  ].filter(Boolean).join(", ");
  const ms = g.milestone;
  const msPct = ms.next ? Math.round(((g.sentTotal - ms.prev) / (ms.next - ms.prev)) * 100) : 100;

  return (
    <>
      <button type="button" className="wkp" popoverTarget="week-panel" data-done={done ? "1" : undefined} hidden={home}
              aria-label={`This week's goals: ${g.sent} of ${g.target} applications sent. Open the weekly goals`}>
        <Rings rings={weekRings(g)} size={22} from={from} burst={false} className="rings--mini" />
        <span className="wkp-n"><b><Rolling value={g.sent} from={from?.send} /></b><span className="wkp-of"> of </span>{g.target}</span>
        {g.streak.weeks > 0 ? <span className="wkp-streak" title={`${g.streak.weeks}-week streak`}>{g.streak.weeks} wk</span> : null}
      </button>

      <div id="week-panel" popover="auto" className="wkpop" aria-label="This week's goals" ref={panel}
           onClick={(e) => { if ((e.target as HTMLElement).closest("a")) e.currentTarget.hidePopover(); }}>
        <header className="wkpop-h">
          <h2>This week&apos;s goals</h2>
          <span>{fmt(g.weekStart)} to {fmt(g.weekEnd)} · {g.daysLeft === 1 ? "last day" : `${g.daysLeft} days left`}</span>
        </header>

        <div className="wkpop-hero">
          <Rings key={opened} rings={weekRings(g)} size={128} from={opened ? zero : null} />
          <dl className="wkpop-nums">
            <div data-ring="send">
              <dt>Sent</dt>
              <dd><Rolling key={opened} value={g.sent} from={opened ? 0 : null} /><span>/ {g.target}</span></dd>
            </div>
            <div data-ring="tests">
              <dt>Online assessments</dt>
              <dd><Rolling key={opened} value={g.testsDone} from={opened ? 0 : null} /><span>/ {TESTS_PER_WEEK}</span></dd>
              <p className="wkpop-none">{g.tests ? `${g.tests} waiting to sit` : "none waiting"}</p>
            </div>
            <div data-ring="video">
              <dt>HireVues</dt>
              <dd><Rolling key={opened} value={g.hirevuesDone} from={opened ? 0 : null} /><span>/ {HIREVUES_PER_WEEK}</span></dd>
              <p className="wkpop-none">{g.hirevues ? `${g.hirevues} waiting to record` : "none waiting"}</p>
            </div>
          </dl>
        </div>
        <p className="wkpop-why">
          {done ? <b>Week done. </b> : <b>{left} to send. </b>}
          Target {why}. 40 by {fmt("2026-12-19")} needs {g.pace} a week.
        </p>

        <section className="wkpop-sec" aria-label="Streak">
          <ol className="streak" aria-label={`${g.streak.weeks}-week streak`}>
            {g.streak.history.map((w, i) => {
              const cur = i === g.streak.history.length - 1;
              return (
                <li key={w.weekStart} data-on={w.sent > 0 ? "1" : undefined} data-cur={cur ? "1" : undefined}
                    style={{ "--i": i } as React.CSSProperties}
                    title={`Week of ${fmt(w.weekStart)}: ${w.sent} sent`}>
                  <i />
                </li>
              );
            })}
          </ol>
          <p>
            <b>{g.streak.weeks === 1 ? "1-week" : `${g.streak.weeks}-week`} streak</b>
            {g.streak.thisWeekCounts ? "" : g.streak.weeks ? ". Send one this week to keep it" : ". Send one to start it"}
            {g.streak.restUsed ? ". One quiet week forgiven" : ""}
          </p>
        </section>

        {!done && plan.length ? (
          <section className="wkpop-sec" aria-label="To fill the ring">
            <h3>Fills the ring</h3>
            <ul className="plan">
              {plan.map((p) => (
                <li key={p.jobId}>
                  <Logo company={{ name: p.company, logoUrl: p.logoUrl, domain: p.domain }} size={24} />
                  <Link href={`/jobs/${p.jobId}`} transitionTypes={["nav-forward"]} className="plan-t">
                    <b>{p.company}</b><span>{p.title}</span>
                  </Link>
                  {p.days !== null && p.days <= 7 ? <span className="plan-d">{p.days === 0 ? "today" : `${p.days}d`}</span> : null}
                  {p.why === "finish"
                    ? <Link href={`/jobs/${p.jobId}`} transitionTypes={["nav-forward"]} className="plan-go plan-go--finish">Finish</Link>
                    : <StartButton jobId={p.jobId} company={p.company} label="Start" variant="small" />}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <footer className="wkpop-ms">
          <span>{ms.next ? <>Next milestone: <b>{ms.next} sent</b></> : <b>All 40 sent</b>}</span>
          <span className="ms-bar" role="img" aria-label={`${g.sentTotal} sent in total`}><i style={{ width: `${msPct}%` }} /></span>
          <span className="ms-n">{g.sentTotal}{ms.next ? `/${ms.next}` : ""}</span>
        </footer>
      </div>
    </>
  );
}
