/**
 * `/applications` — the tracker, built around "what needs me, and when" (Jonno's rework, 2026-09-27).
 *
 *  0. The climb (components/Climb.tsx): every stage as a rising cube with its roles piled on top, ending at the goal.
 *  1. Runway: the next three weeks as day columns, with a company mark on every day something is due.
 *  2. Now: anything due today, tomorrow or late, as big hot cards with their action buttons.
 *  3. This week + Needs a call: dated items 2–7 days out, and roles whose listing looks dead (keep or dismiss).
 *  4. Pipeline: every tracked role with a one-click stage track (Undo on every move) and an inline next step.
 *  5. Archive: closed (the employer ended the process), rejected and dismissed roles, collapsed.
 *
 * The urgency rules live in lib/tracker/attention.ts (unit-tested). Writes go through app/actions.ts, layer 3 only.
 * A tracked role stays here even after the pipeline filters it out, deactivates it or finds it closed.
 */
import Link from "next/link";
import { PageSlide } from "@/components/PageSlide";
import { listApplications, listEmailUpdates, type ApplicationRow, type EmailUpdateRow } from "@/lib/queries";
import { daysUntil, fmtDate } from "@/lib/ui/format";
import { attention, callFor, FINISHED, PRE_SUBMIT, SUBMITTED, whenLabel, type AttentionItem, type Call } from "@/lib/tracker/attention";
import { Logo } from "@/components/primitives";
import { ActionDoneButton } from "@/components/ActionDoneButton";
import { StageTrack, UndoToast } from "@/components/StageTrack";
import { NextStep } from "@/components/NextStep";
import { Climb } from "@/components/Climb";
import { IconClock, IconExternal, IconLetter, IconTarget, IconWarn } from "@/lib/ui/icons";

export const dynamic = "force-dynamic";

const EMAIL_KIND_LABEL: Record<string, string> = {
  received: "Application received", assessment_invite: "Assessment invite", interview_invite: "Interview invite",
  offer: "Offer", rejection: "Rejection", action_required: "Action required", other: "Update",
};
const KIND_ICON = { email: IconLetter, step: IconTarget, deadline: IconClock } as const;
const KIND_WORD = { email: "Recruiter asked", step: "Your step", deadline: "Deadline" } as const;
const HORIZON = 21;
/** furthest along first */
const SUBMITTED_ORDER = [...SUBMITTED].reverse();

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ------------------------------------------------------------------------------------------------ runway

function Runway({ items, now }: { items: AttentionItem[]; now: Date }) {
  const late = items.filter((i) => i.days < 0);
  const days = Array.from({ length: HORIZON }, (_, d) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
    return { d, date, items: items.filter((i) => i.days === d) };
  });
  const beyond = items.filter((i) => i.days >= HORIZON).length;

  return (
    <section className="rw" aria-labelledby="rw-h">
      <h2 id="rw-h" className="sr">The next three weeks</h2>
      <div className="rw-scroll">
        <ol className="rw-days" style={{ gridTemplateColumns: `${late.length ? "minmax(40px,1fr) " : ""}repeat(${HORIZON}, minmax(34px,1fr))` }}>
          {late.length ? (
            <li className="rw-day" data-band="late">
              <span className="rw-date"><b>Late</b></span>
              <span className="rw-stack">{late.map((i) => <Marker key={i.key} i={i} />)}</span>
            </li>
          ) : null}
          {days.map(({ d, date, items: its }) => {
            const wd = date.getDay();
            return (
              <li
                key={d} className="rw-day"
                data-band={d <= 1 ? "now" : d <= 7 ? "soon" : undefined}
                data-weekend={wd === 0 || wd === 6 ? "1" : undefined}
                data-monday={wd === 1 && d > 0 ? "1" : undefined}
              >
                <span className="rw-date">
                  <span className="rw-wd">{d === 0 ? "Today" : date.toLocaleDateString("en-GB", { weekday: "short" }).slice(0, 2)}</span>
                  <b>{date.getDate()}</b>
                </span>
                <span className="rw-stack">{its.map((i) => <Marker key={i.key} i={i} />)}</span>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="rw-key">
        <span><IconLetter width={12} height={12} /> recruiter asked</span>
        <span><IconTarget width={12} height={12} /> your step</span>
        <span><IconClock width={12} height={12} /> applications close</span>
        {beyond ? <span className="rw-more">{plural(beyond, "more date")} after three weeks</span> : null}
      </p>
    </section>
  );
}

function Marker({ i }: { i: AttentionItem }) {
  const Icon = KIND_ICON[i.kind];
  const label = `${i.company}: ${i.kind === "deadline" ? "applications close" : i.text} (${whenLabel(i.days)})`;
  const body = (
    <>
      <Logo company={{ name: i.company, logoUrl: i.logoUrl, domain: i.domain }} size={24} />
      <span className="rw-kind"><Icon width={10} height={10} /></span>
    </>
  );
  return i.jobId
    ? <Link href={`/jobs/${i.jobId}`} transitionTypes={["nav-forward"]} className="rw-mark" data-level={i.level} data-kind={i.kind} title={label} aria-label={label}>{body}</Link>
    : <span className="rw-mark" data-level={i.level} data-kind={i.kind} title={label} aria-label={label}>{body}</span>;
}

// ------------------------------------------------------------------------------------------ now + week

function NowCard({ i }: { i: AttentionItem }) {
  const Icon = KIND_ICON[i.kind];
  return (
    <li className="now" data-kind={i.kind} data-late={i.days < 0 ? "1" : undefined}>
      <div className="now-when">
        <span className="now-pulse" aria-hidden="true" />
        <b>{whenLabel(i.days)}</b>
        <span>{fmtDate(i.date)}</span>
      </div>
      <p className="now-what">{i.kind === "deadline" ? `Applications close for ${i.title ?? "this role"}` : i.text}</p>
      <div className="now-who">
        <Logo company={{ name: i.company, logoUrl: i.logoUrl, domain: i.domain }} size={20} />
        {i.jobId ? <Link href={`/jobs/${i.jobId}`} transitionTypes={["nav-forward"]}>{i.company}</Link> : <span>{i.company}</span>}
        <span className="now-kind"><Icon width={12} height={12} /> {KIND_WORD[i.kind]}</span>
      </div>
      <div className="now-acts">
        {i.email?.viewUrl ? (
          <a href={i.email.viewUrl} target="_blank" rel="noreferrer" className="btn btn--sm btn--go">
            Open email <IconExternal width={12} height={12} />
          </a>
        ) : i.jobId ? (
          <Link href={`/jobs/${i.jobId}`} transitionTypes={["nav-forward"]} className="btn btn--sm btn--go">Open role</Link>
        ) : null}
        {i.email ? <ActionDoneButton id={i.email.id} done={false} /> : null}
      </div>
    </li>
  );
}

function WeekRow({ i }: { i: AttentionItem }) {
  const Icon = KIND_ICON[i.kind];
  return (
    <li className="wk">
      <span className="wk-d"><b>{i.days}</b>d</span>
      <Logo company={{ name: i.company, logoUrl: i.logoUrl, domain: i.domain }} size={22} />
      <span className="wk-t">
        {i.jobId ? <Link href={`/jobs/${i.jobId}`} transitionTypes={["nav-forward"]}>{i.company}</Link> : i.company}
        <span>{i.kind === "deadline" ? "applications close" : i.text}</span>
      </span>
      <Icon width={13} height={13} className="wk-i" label={KIND_WORD[i.kind]} />
    </li>
  );
}

function CallRow({ c }: { c: Call }) {
  return (
    <li className="call">
      <IconWarn width={14} height={14} className="call-i" />
      <span className="call-t">
        <Link href={`/jobs/${c.app.jobId}`} transitionTypes={["nav-forward"]}>{c.app.company}</Link>
        <span>{c.reason.length > 110 ? `${c.reason.slice(0, 110)}…` : c.reason}</span>
      </span>
    </li>
  );
}

// ------------------------------------------------------------------------------------------------ pipeline

const ARCHIVE_WORD: Record<string, string> = { closed: "Closed", rejected: "Rejected", dismissed: "Dismissed" };

function Countdown({ a, dead }: { a: ApplicationRow; dead: boolean }) {
  if (FINISHED.has(a.status)) {
    return <span className="cd" data-level="gone"><b>{ARCHIVE_WORD[a.status]}</b><span>{fmtDate(a.lastActivityAt ?? a.updatedAt)}</span></span>;
  }
  if (PRE_SUBMIT.has(a.status)) {
    const d = daysUntil(a.deadline);
    if (d === null) return <span className="cd" data-level="none"><span>No deadline</span></span>;
    if (d < 0) return <span className="cd" data-level="past"><b>Closed</b><span>{fmtDate(a.deadline)}</span></span>;
    return (
      <span className="cd" data-level={d <= 1 ? "now" : d <= 7 ? "soon" : "later"} data-dead={dead ? "1" : undefined} title={`Closes ${fmtDate(a.deadline)}`}>
        <b>{d === 0 ? "Today" : d}</b><span>{d === 0 ? "closes" : d === 1 ? "day left" : "days left"}</span>
      </span>
    );
  }
  if (a.appliedAt) {
    const ago = -(daysUntil(a.appliedAt) ?? 0);
    return <span className="cd" data-level="done" title={`Applied ${fmtDate(a.appliedAt)}`}><b>{ago}</b><span>{ago === 1 ? "day since applying" : "days since applying"}</span></span>;
  }
  return null;
}

function RoleRow({ a, mail }: { a: ApplicationRow; mail?: EmailUpdateRow }) {
  const call = callFor(a);
  return (
    <li className="role" data-s={a.status}>
      <Logo company={{ name: a.company, logoUrl: a.logoUrl, domain: a.domain }} size={38} />
      <div className="role-main">
        <div className="role-name">
          <Link href={`/jobs/${a.jobId}`} transitionTypes={["nav-forward"]} className="role-title">{a.title}</Link>
          <Link href={`/companies/${a.companySlug}`} className="role-co">{a.company}</Link>
        </div>
        <Countdown a={a} dead={!!call} />
        {call ? <p className="role-warn"><IconWarn width={12} height={12} /> {call.length > 120 ? `${call.slice(0, 120)}…` : call}</p> : null}
        {/* where am I → what next → when: the next step reads first, the stage track under it */}
        {FINISHED.has(a.status) ? (
          a.dismissedReason ? <p className="role-note">{a.dismissedReason}</p> : null
        ) : (
          <NextStep jobId={a.jobId} text={a.nextAction} due={a.nextActionDue} status={a.status} appliedAt={a.appliedAt} />
        )}
        <StageTrack jobId={a.jobId} status={a.status} company={a.company} />
        {mail ? (
          <p className="role-mail">
            <IconLetter width={12} height={12} />
            <span>{fmtDate(mail.receivedAt)} · {EMAIL_KIND_LABEL[mail.kind] ?? mail.kind}{mail.summary ? `: ${mail.summary}` : ""}</span>
          </p>
        ) : null}
      </div>
    </li>
  );
}

function Lane({ id, title, hint, rows, latest, empty }: {
  id: string; title: string; hint: string; rows: ApplicationRow[]; latest: Map<number, EmailUpdateRow>; empty: string;
}) {
  return (
    <section className="lane" aria-labelledby={id}>
      <h2 id={id}>{title} <span className="n">{rows.length}</span><span className="lane-hint">{hint}</span></h2>
      {rows.length
        ? <ul>{rows.map((a) => <RoleRow key={a.id} a={a} mail={latest.get(a.id)} />)}</ul>
        : <p className="lane-empty">{empty}</p>}
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ page

export default async function ApplicationsPage() {
  const now = new Date();
  const all = listApplications();
  const emails = listEmailUpdates();
  const latest = new Map<number, EmailUpdateRow>();
  for (const e of emails) if (e.applicationId && !latest.has(e.applicationId)) latest.set(e.applicationId, e);   // newest first
  const unmatched = emails.filter((e) => e.applicationId === null && e.kind !== "other");

  const { items, calls } = attention(all, emails, now);
  const nowItems = items.filter((i) => i.level === "now");
  const soon = items.filter((i) => i.level === "soon");

  const toApply = all.filter((a) => PRE_SUBMIT.has(a.status)).sort((x, y) =>
    Number(!!callFor(x)) - Number(!!callFor(y)) || (daysUntil(x.deadline) ?? 999) - (daysUntil(y.deadline) ?? 999));
  const submitted = all.filter((a) => SUBMITTED_ORDER.includes(a.status))
    .sort((x, y) => SUBMITTED_ORDER.indexOf(x.status) - SUBMITTED_ORDER.indexOf(y.status));
  const finished = all.filter((a) => FINISHED.has(a.status));

  const lateN = nowItems.filter((i) => i.days < 0).length;
  const say = [
    lateN ? `${plural(lateN, "thing")} late` : null,
    nowItems.length - lateN ? `${nowItems.length - lateN} due by tomorrow` : null,
    soon.length ? `${soon.length} more this week` : null,
  ].filter(Boolean);

  if (all.length === 0) {
    return (
      <PageSlide><main className="wrap ff ap">
        <h1 className="ap-h1">Applications</h1>
        <p className="empty">
          <b>Nothing tracked yet.</b>
          Open a role from the <Link href="/" className="link-mint">Roles</Link> list and press Interested to start its track here.
        </p>
      </main></PageSlide>
    );
  }

  return (
    <PageSlide><main className="wrap ff ap">
      <header className="ap-head">
        <h1 className="ap-h1">Applications</h1>
        <p className="ap-say">
          {say.length ? <><b data-hot={nowItems.length ? "1" : undefined}>{say.join(", ")}.</b> </> : <b>Nothing due this week. </b>}
          {plural(toApply.length, "role")} to apply for, {submitted.length} submitted.
        </p>
      </header>

      <Climb apps={all} />

      <Runway items={items} now={now} />

      {nowItems.length ? (
        <section className="ap-sec" aria-labelledby="now-h">
          <h2 id="now-h" className="ap-h2 ap-h2--hot">Due now</h2>
          <ul className="now-grid">{nowItems.map((i) => <NowCard key={i.key} i={i} />)}</ul>
        </section>
      ) : null}

      {soon.length || calls.length ? (
        <div className="ap-pair">
          {soon.length ? (
            <section aria-labelledby="wk-h">
              <h2 id="wk-h" className="ap-h2 ap-h2--warm">This week</h2>
              <ul className="wk-list">{soon.map((i) => <WeekRow key={i.key} i={i} />)}</ul>
            </section>
          ) : null}
          {calls.length ? (
            <section aria-labelledby="call-h">
              <h2 id="call-h" className="ap-h2">Needs a call <span className="lane-hint">still worth it? keep it, or dismiss below</span></h2>
              <ul className="call-list">{calls.map((c) => <CallRow key={c.app.id} c={c} />)}</ul>
            </section>
          ) : null}
        </div>
      ) : null}

      <Lane id="l-apply" title="To apply" hint="soonest deadline first" rows={toApply} latest={latest}
        empty="Nothing waiting to go in. Mark a role Interested from the Roles list to line it up here." />
      <Lane id="l-sub" title="Submitted" hint="furthest along first" rows={submitted} latest={latest}
        empty="Nothing submitted yet." />

      {unmatched.length ? (
        <section className="lane" aria-labelledby="l-mail">
          <h2 id="l-mail">Emails about roles you haven&apos;t tracked <span className="n">{unmatched.length}</span></h2>
          <ul className="call-list">
            {unmatched.map((e) => (
              <li key={e.id} className="call">
                <IconLetter width={14} height={14} className="call-i" />
                <span className="call-t">
                  <b>{e.companyHint ?? e.sender}</b>
                  <span>{fmtDate(e.receivedAt)} · {EMAIL_KIND_LABEL[e.kind] ?? e.kind}: {e.subject}. Find the role in Roles and track it to link this.</span>
                </span>
                {e.viewUrl ? <a href={e.viewUrl} target="_blank" rel="noreferrer" className="link-mint">Open email</a> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {finished.length ? (
        <details className="ap-done" id="archive">
          <summary>
            Archive <span className="n">{finished.length}</span>
            <span className="lane-hint">
              {(["closed", "rejected", "dismissed"] as const).map((s) => [s, finished.filter((a) => a.status === s).length] as const)
                .filter(([, n]) => n).map(([s, n]) => `${n} ${ARCHIVE_WORD[s].toLowerCase()}`).join(", ")}
              . Click a stage to bring one back.
            </span>
          </summary>
          <ul>{finished.map((a) => <RoleRow key={a.id} a={a} mail={latest.get(a.id)} />)}</ul>
        </details>
      ) : null}

      <UndoToast />
    </main></PageSlide>
  );
}

