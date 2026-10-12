/**
 * `/kit` — what Claude uses when it applies. Hero (Jonno 2026-10-08, like the Roles hero): left, two even tiles for the
 * CV and base letter that open full size; right, an open "Waiting on you" column, one row per question group linking to
 * its tab in the Questions section, plus the interview cards. Then Questions, interview cards, the answer bank. Server component: reads lib/kit.ts; the interactive parts are in components/kit/. Styles: `.kx-*` in globals.css.
 */
import { PageSlide } from "@/components/PageSlide";
import { KitCards } from "@/components/kit/KitCards";
import { KitDocs } from "@/components/kit/KitDocs";
import { KitTodo } from "@/components/kit/KitTodo";
import { fmtDate, fmtDateTime } from "@/lib/ui/format";
import { IconChevron, IconQuestions } from "@/lib/ui/icons";
import { answerBank, baseLetter, cvFiles, inbox, interviewCards, openGaps, type KitAnswer } from "@/lib/kit";

export const dynamic = "force-dynamic";

const STATE: Record<string, { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "warn" }, approved: { label: "Approved", tone: "cool" }, submitted: { label: "Sent", tone: "ok" },
};
/** one accent per question group, so the hero rows and their tabs below read as the same thing */
const TONES = ["cool", "vio", "mint", "mid"];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Answers grouped by role, roles with drafts first. */
function byRole(answers: KitAnswer[]) {
  const groups = new Map<number, { jobId: number; company: string; role: string; items: KitAnswer[] }>();
  for (const a of answers) {
    const g = groups.get(a.jobId) ?? groups.set(a.jobId, { jobId: a.jobId, company: a.company, role: a.role, items: [] }).get(a.jobId)!;
    g.items.push(a);
  }
  const drafts = (g: { items: KitAnswer[] }) => g.items.filter((a) => a.status === "draft").length;
  return [...groups.values()].sort((a, b) => drafts(b) - drafts(a));
}

export default function KitPage() {
  const current = cvFiles().find((c) => c.current);
  const letter = baseLetter();
  const answers = answerBank();
  const drafts = answers.filter((a) => a.status === "draft");
  const gaps = openGaps();
  const cards = interviewCards();
  const items = inbox();
  const letterDraft = !!letter && !letter.approved;
  const groups = gaps.map((g, i) => ({ ...g, id: `q-${g.heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`, tone: TONES[i % TONES.length] }));
  const approvals = drafts.length + (letterDraft ? 1 : 0);
  // the hero summary: one row per tab of the Questions section below (ids match KitTodo's)
  const rows = [
    ...(approvals ? [{ id: "q-ok", title: "Ready for your OK", why: "Drafts Claude wrote, waiting for your approval.", tone: "warm", n: approvals }] : []),
    ...groups.map((g) => ({ id: g.id, title: g.heading, why: g.why, tone: g.tone, n: g.items.length })),
  ];
  const cardGaps = cards.filter((c) => c.status).length;

  return (
    <PageSlide>
      <main className="wrap ff kx">
        <header className="kx-head">
          <h1>Application kit</h1>
          <p className="kx-sum">What Claude works from when it applies for you, and what only you can answer.</p>
        </header>

        <div className="kx-hero">
          <KitDocs cv={current ? { pages: current.pages, updated: fmtDateTime(current.modified) } : null} letter={letter} />

          <aside className="kx-wait" aria-labelledby="wait-h">
            <h2 id="wait-h">Waiting on you <b>{rows.reduce((n, r) => n + r.n, 0)}</b></h2>
            {rows.length ? (
              <ul>
                {rows.map((r) => (
                  <li key={r.id}>
                    <a className="kx-wait-row" href={`#${r.id}`} style={{ "--g": `var(--${r.tone})` } as React.CSSProperties}>
                      <i aria-hidden="true" />
                      <span className="kx-wait-t"><b>{r.title}</b>{r.why ? <span>{r.why}</span> : null}</span>
                      <span className="kx-wait-n">{r.n}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : <p className="kx-wait-none">Nothing. Every question is answered.</p>}
            {cards.length ? (
              <a className="kx-wait-cards" href="#cards">
                <span className="kx-tile-ic"><IconQuestions /></span>
                <span className="kx-wait-t">
                  <b>Interview cards</b>
                  <span>{plural(cards.length, "question")} to practise{cardGaps ? `, ${cardGaps} still missing a story or detail` : ""}</span>
                </span>
                <IconChevron />
              </a>
            ) : null}
          </aside>
        </div>

        <KitTodo letterDraft={letterDraft} groups={groups}
          drafts={drafts.map(({ id, jobId, company, question, text, words }) => ({ id, jobId, company, question, text, words }))} />

        <KitCards cards={cards} />

        {answers.length ? (
          <section id="bank" className="kx-bank" aria-labelledby="bank-h">
            <header className="kx-sec-h">
              <h2 id="bank-h">Answer bank</h2>
              <p>Answers you&apos;ve written for real forms. Apply runs adapt them when a form asks something similar.</p>
            </header>
            <div className="kx-roles">
              {byRole(answers).map((r) => (
                <a key={r.jobId} className="kx-role" href={`/jobs/${r.jobId}#answers-h`}>
                  <span className="kx-role-h"><b>{r.company}</b><IconChevron /></span>
                  <span className="kx-role-sub">{r.role}</span>
                  <span className="kx-role-qs">
                    {r.items.map((a) => (
                      <span key={a.id} className="kx-role-q">
                        <span className="kx-pill" data-tone={STATE[a.status]?.tone ?? "off"}>{STATE[a.status]?.label ?? a.status}</span>
                        <span>{a.question.replace(/\s*\(.*$/, "")}</span>
                      </span>
                    ))}
                  </span>
                </a>
              ))}
            </div>
          </section>
        ) : null}

        {items.length ? (
          <section className="kx-bank" aria-labelledby="inbox-h">
            <header className="kx-sec-h">
              <h2 id="inbox-h">Inbox</h2>
              <p>Imports a Claude session still has to merge into your store.</p>
            </header>
            <ul className="kx-inbox">
              {items.map((it) => <li key={it.file}><b>{it.file}</b><span>{it.lines} lines, added {fmtDate(it.modified)}</span></li>)}
            </ul>
          </section>
        ) : null}
      </main>
    </PageSlide>
  );
}
