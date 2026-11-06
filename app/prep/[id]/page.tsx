/**
 * `/prep/[id]` — one role's assessment prep hub (Jonno 2026-11-04: "see that I have a HireVue and not have to leave
 * Gradfinder ... still be adequately prepared"). Tabs are URL state (`?tab=`), so back works and no JS is needed to
 * read. Content comes from `profile/prep/<id>.json` (lib/prep.ts): Sky's own words and published write-ups, labelled
 * third-party reports, and his confirmed stories. Interactive parts are two client components: the HireVue practice
 * deck (timer) and the maths drill. Styles: `.pp-*` in globals.css. Nothing here writes.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageSlide } from "@/components/PageSlide";
import { Logo } from "@/components/primitives";
import { HireVueDeck } from "@/components/prep/HireVueDeck";
import { MathDrill } from "@/components/prep/MathDrill";
import { IconExternal } from "@/lib/ui/icons";
import { APPLICATION_STATUS_LABEL, daysUntil, fmtDate } from "@/lib/ui/format";
import { prepFor, type PrepFile } from "@/lib/prep";

export const dynamic = "force-dynamic";

const TABS = [
  ["start", "Start here"], ["values", "Values"], ["behavioural", "Behavioural test"],
  ["reasoning", "Reasoning test"], ["hirevue", "HireVue"], ["sources", "Sources"],
] as const;
type Tab = (typeof TABS)[number][0];

/** How a fact is sourced, in words and in the tag's shape (solid, dashed, plain): never colour alone. */
const KIND = { sky: "Sky says", reported: "Third party, not Sky", technique: "General technique" } as const;

function Facts({ facts }: { facts: PrepFile["behavioural"]["facts"] }) {
  return (
    <ul className="pp-facts">
      {facts.map((f) => (
        <li key={f.text}>
          <span className="pp-kind" data-k={f.kind}>{KIND[f.kind]}</span>
          <span>{f.text}</span>
          {f.url ? <a href={f.url} target="_blank" rel="noreferrer" aria-label="Open source"><IconExternal /></a> : null}
        </li>
      ))}
    </ul>
  );
}

const List = ({ items }: { items: string[] }) => <ul className="pp-list">{items.map((t) => <li key={t}>{t}</li>)}</ul>;
const Checks = ({ items }: { items: string[] }) => (
  <ul className="pp-checks">{items.map((t) => <li key={t}><i aria-hidden="true" />{t}</li>)}</ul>
);
const Sec = ({ h, children }: { h: string; children: React.ReactNode }) => (
  <section className="pp-sec"><h2>{h}</h2>{children}</section>
);

export default async function PrepPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId)) notFound();
  const found = prepFor(jobId);
  if (!found) notFound();
  if ("error" in found) {
    return <PageSlide><main className="wrap ff pp"><h1>Prep file is invalid</h1><p className="pp-sum">{found.error}</p></main></PageSlide>;
  }
  const { prep, role } = found;
  const sp = await searchParams;
  const tab: Tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as Tab) : "start";
  const d = daysUntil(role.due);

  return (
    <PageSlide>
      <main className="wrap ff pp">
        <nav className="pp-crumb" aria-label="Breadcrumb">
          <Link href="/prep" transitionTypes={["nav-back"]}>Prep</Link><span aria-hidden="true">/</span><span>{role.company}</span>
        </nav>
        <header className="pp-hero">
          <Logo company={{ name: role.company, logoUrl: role.logoUrl, domain: role.domain }} size={56} />
          <div>
            <h1>{role.company} prep</h1>
            <p className="pp-sum">{role.title}</p>
          </div>
          <dl className="pp-now">
            <div><dt>Stage</dt><dd>{APPLICATION_STATUS_LABEL[role.status ?? ""] ?? role.status ?? "Not tracked"}</dd></div>
            {role.due ? (
              <div>
                <dt>{role.dueText?.replace(/\s*\(.*$/, "") ?? "Due"}</dt>
                <dd>{fmtDate(role.due)}{d != null ? ` · ${d < 0 ? `${-d}d overdue` : d === 0 ? "today" : `${d}d left`}` : ""}</dd>
              </div>
            ) : null}
            <div><dt>Role page</dt><dd><Link href={`/jobs/${role.jobId}`}>Open</Link></dd></div>
          </dl>
        </header>

        <nav className="pp-tabs" aria-label="Prep sections">
          {TABS.map(([k, label]) => (
            <Link key={k} href={`/prep/${jobId}?tab=${k}`} replace scroll={false} aria-current={tab === k ? "page" : undefined}>{label}</Link>
          ))}
        </nav>

        {tab === "start" ? (
          <>
            <p className="pp-lede">{prep.headline}</p>
            <Sec h="In this order">
              <ol className="pp-steps">
                {prep.start.steps.map((s) => (
                  <li key={s.title}><b>{s.title}</b><em>{s.when}</em><span>{s.note}</span></li>
                ))}
              </ol>
            </Sec>
            <Sec h="Ground rules"><List items={prep.start.rules} /></Sec>
            <Sec h="Not known yet"><List items={prep.start.unknowns} /></Sec>
          </>
        ) : null}

        {tab === "values" ? (
          <>
            <p className="pp-lede">{prep.valuesIntro}</p>
            <div className="pp-values">
              {prep.values.map((v) => (
                <article key={v.name} className="pp-value">
                  <h2>{v.name}</h2>
                  <blockquote>{v.says}</blockquote>
                  <p className="pp-mean">{v.meaning}</p>
                  <h3>Your evidence</h3>
                  <List items={v.evidence} />
                  <p className="pp-words"><b>Words to echo:</b> {v.wording.join(" · ")}</p>
                </article>
              ))}
            </div>
            <Sec h="What this programme asks for"><List items={prep.programmeSkills} /></Sec>
          </>
        ) : null}

        {tab === "behavioural" ? (
          <>
            <Sec h="What it is"><Facts facts={prep.behavioural.facts} /></Sec>
            <Sec h="How to play it"><List items={prep.behavioural.approach} /></Sec>
            <Sec h="Before you start"><Checks items={prep.behavioural.checklist} /></Sec>
          </>
        ) : null}

        {tab === "reasoning" ? (
          <>
            <Sec h="What it is"><Facts facts={prep.reasoning.facts} /></Sec>
            <Sec h="How to play it"><List items={prep.reasoning.approach} /></Sec>
            <Sec h="Warm-up drill"><MathDrill /></Sec>
            <Sec h="Before you start"><Checks items={prep.reasoning.checklist} /></Sec>
          </>
        ) : null}

        {tab === "hirevue" ? (
          <>
            <Sec h="What it is"><Facts facts={prep.hirevue.facts} /></Sec>
            <div className="pp-cols">
              <Sec h="Set up"><List items={prep.hirevue.setup} /></Sec>
              <Sec h="Your method"><List items={prep.hirevue.method} /></Sec>
            </div>
            <Sec h="Fix these from your WTW practice"><List items={prep.hirevue.pitfalls} /></Sec>
            <Sec h="Practise: likely questions"><HireVueDeck questions={prep.hirevue.questions} /></Sec>
          </>
        ) : null}

        {tab === "sources" ? (
          <Sec h="Where this came from">
            <ul className="pp-list">
              {prep.sources.map((s) => (
                <li key={s.label}>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.label}</a> : s.label}</li>
              ))}
            </ul>
            <p className="pp-note">Updated {fmtDate(prep.updated)}. Tags say who said it: Sky, a third party, or general technique. Stories come from your store and are labelled in /kit. Missing something? Ask a Claude session to update <code>profile/prep/{jobId}.json</code>.</p>
          </Sec>
        ) : null}
      </main>
    </PageSlide>
  );
}
