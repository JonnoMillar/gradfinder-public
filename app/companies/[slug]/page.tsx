/**
 * `/companies/[slug]` — company factfile: what we know, its open roles, and recent news.
 * Same rule as the job factfile: every claim carries its source, absence renders as absence.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageSlide } from "@/components/PageSlide";
import { AiDots, FactLine, Logo, NewsList } from "@/components/primitives";
import { JobRow } from "@/components/JobRow";
import { IconChevron, IconWarn } from "@/lib/ui/icons";
import { fmtDate, hostOf, sectorColor, sectorLabel } from "@/lib/ui/format";
import { factsFor, getCompanyBySlug, jobsForCompany, newsForCompany } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function CompanyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const company = getCompanyBySlug(slug);
  if (!company) notFound();

  const facts = factsFor("company", company.id);
  const jobs = jobsForCompany(company.id);
  const news = newsForCompany(company.id);
  const kept = jobs.filter((j) => !j.excludedReason);
  const filtered = jobs.filter((j) => j.excludedReason);
  const wiki = facts.find((f) => f.field === "what_they_do" && f.sourceKind === "wikipedia");
  const snippets = facts.filter((f) => f.field === "search_snippets");
  const claims = facts.filter((f) => f.field !== "search_snippets");

  return (
    <PageSlide>
    <main className="wrap ff" style={{ "--sec": sectorColor(company.sector) } as React.CSSProperties}>
      <p className="crumb"><Link href="/" transitionTypes={["nav-back"]}>Roles</Link> · {company.name}</p>

      <div className="ffh">
        <Logo company={{ name: company.name, logoUrl: company.logoUrl, domain: company.domain }} size={52} />
        <div style={{ minWidth: 0 }}>
          <div className="ffco">
            <i />
            <span>{sectorLabel(company.sector)}</span>
            <AiDots level={company.aiForward} />
            {company.aiForward != null ? <span>AI-forward {company.aiForward}/3</span> : null}
          </div>
          <h1>{company.name}</h1>
          <div className="chips">
            <span className="c">{kept.length} open role{kept.length === 1 ? "" : "s"}</span>
            {company.hq ? <span className="c">HQ {company.hq}</span> : null}
            {company.sizeBand ? <span className="c">{company.sizeBand}</span> : null}
            {company.website ? (
              <a className="c" href={company.website} target="_blank" rel="noreferrer">
                {hostOf(company.website)} ↗
              </a>
            ) : null}
          </div>
        </div>
      </div>

      <h3 className="sec-h">What they do</h3>
      {company.summary
        ? <p className="prose">{company.summary}</p>
        : company.sector == null && company.aiForward == null
          ? (
            <p className="prose">
              Not researched yet. With no sector and no AI-forwardness, every role here ranks on its
              kind and deadline alone.
            </p>
          )
          // researched, but no Wikipedia article is confidently about this employer: say so rather than
          // implying nothing was found — the sector and AI-forwardness above are sourced in the facts below
          : <p className="prose">No summary: no Wikipedia article was confidently about this employer. The
              sector and AI-forwardness above come from the facts below, each with its source.</p>}
      {wiki ? (
        <div className="warn">
          <IconWarn />
          <span>
            <b>Source check.</b> This summary comes from{" "}
            <a className="src" href={wiki.sourceUrl} target="_blank" rel="noreferrer">
              {hostOf(wiki.sourceUrl)}{new URL(wiki.sourceUrl).pathname.replace("/wiki/", "/")}
            </a>{" "}
            — confirm it describes this employer and not a similarly-named organisation.
          </span>
        </div>
      ) : null}
      {company.aiForwardRationale ? (
        <p className="prose" style={{ marginTop: 12, fontSize: 13 }}>{company.aiForwardRationale}</p>
      ) : null}

      <h3 className="sec-h">
        Open roles <span className="n">— {kept.length} kept{filtered.length ? `, ${filtered.length} filtered out` : ""}</span>
      </h3>
      {kept.length
        ? <div className="tiles">{kept.map((j) => <JobRow key={j.id} job={j} />)}</div>
        : <p className="prose">No roles here survived the criteria.</p>}

      {filtered.length ? (
        <details className="disc">
          <summary>
            <IconChevron />Roles the rules filtered out
            <span className="cnt">{filtered.length}</span>
          </summary>
          <div className="dbody tiles">{filtered.map((j) => <JobRow key={j.id} job={j} />)}</div>
        </details>
      ) : null}

      {claims.length ? (
        <>
          <h3 className="sec-h">
            Facts <span className="n">— {claims.length} rows, every one with a source_url</span>
          </h3>
          <div>{claims.map((f, i) => <FactLine key={i} fact={f} />)}</div>
        </>
      ) : null}

      <h3 className="sec-h">Recent news <span className="n">— Google News, last 30 days</span></h3>
      <NewsList items={news} />

      {snippets.length ? (
        <details className="disc">
          <summary>
            <IconChevron />Search snippets
            <span className="cnt">{snippets.length} queries</span>
          </summary>
          <div className="dbody">{snippets.map((f, i) => <FactLine key={i} fact={f} />)}</div>
        </details>
      ) : null}

      <div className="prov">
        <b>Provenance.</b>{" "}
        {company.researchUpdatedAt
          ? <>Wikipedia and news last fetched {fmtDate(company.researchUpdatedAt.slice(0, 10))}.</>
          : <>This company has never been through a research run.</>}{" "}
        Sector and AI-forwardness are judged by an LLM over the sources shown above, and any claim
        that could not cite one of them was dropped before it reached this page.
      </div>
    </main>
    </PageSlide>
  );
}
