/**
 * `/jobs/[id]` — the role page (v2 step 3; redesigned 2026-09-25 after Jonno's review: cards over rows, a career
 * flow chart, a proper company section, more colour, shorter text).
 *
 * Order (2026-09-29, after the Roles page work: what to do first, context after): the hero carries the fit ring, the
 * stage and the next step with its date · key facts · the job · can you get it · your angle · process & dates · pay ·
 * career path · hours & culture · company · application kit · scores · sources drawer.
 *
 * Three kinds of content, always labelled: what the posting says; sourced deep-research claims (`dr.*` facts,
 * lib/apply/research.ts — each card links its source, and the quoted sentence is in the link tooltip and the
 * sources drawer); and Claude's judgement (evaluation, fit, angle, career path, scores), badged "Claude's read".
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageSlide } from "@/components/PageSlide";
import { Logo, SourceLink, AiDots, FactLine } from "@/components/primitives";
import { TrackerPanel } from "@/components/TrackerPanel";
import { NextStep } from "@/components/NextStep";
import { FitRing } from "@/components/FitRing";
import { StageTrack, UndoToast } from "@/components/StageTrack";
import { NotInterested } from "@/components/NotInterested";
import { AnswersPanel } from "@/components/AnswersPanel";
import { RunPanel } from "@/components/RunPanel";
import { ValueCards } from "@/components/ValueCards";
import { latestRuns, openQuestions } from "@/lib/runs/runs";
import { runUsage } from "@/lib/runs/usage";
import { Section, Unknown } from "@/components/Research";
import {
  CareerFlow, ClaimCards, CommuteBars, FitList, FitMeter, GlanceTiles, Judgement, KeyFacts, NewsTimeline,
  ScoreBars, Snippets, SourcesDrawer, Timeline, type KeyFact, type TimelineItem,
} from "@/components/RoleVisuals";
import { listAnswers } from "@/lib/apply/answers";
import {
  IconBriefcase, IconBuilding, IconChart, IconHeart, IconChevron, IconClock, IconExternal, IconFolder, IconMode, IconNews,
  IconPay, IconPin, IconRoute, IconSpark, IconStart, IconTarget, IconTrain, IconTrend, IconWarn, REQ_ICON,
} from "@/lib/ui/icons";
import {
  daysUntil, deadlineTier, fmtDate, hostOf, kindLabel, locationParts,
  rankLines, REQ_FIELDS, reqState, reqWord, sectorColor, sectorLabel,
} from "@/lib/ui/format";
import { activityFor, companyGlance, factsFor, getEvaluation, getJob, liveness, researchFor } from "@/lib/queries";
import { WEIGHTS } from "@/lib/evaluate";
import { intakeStatus } from "@/lib/pipeline/filter";

export const dynamic = "force-dynamic";

const find = (fs: ReturnType<typeof factsFor>, field: string) => fs.find((f) => f.field === field);
const SCORE_LABEL: Record<keyof typeof WEIGHTS, string> = {
  workFit: "Work fit", chance: "Realistic chance", companyType: "Company type", careerPath: "Career path", sector: "Sector", pay: "Pay",
};
const DEALBREAKER_LABEL: Record<string, string> = { hours: "Hours", outside_london: "Outside London", old_fashioned: "Old-fashioned" };
const TOC: [string, string, string][] = [
  ["do", "The job", "job"], ["chance", "Can you get it", "chance"], ["values", "Values", "values"], ["angle", "Your angle", "angle"],
  ["process", "Process", "process"], ["pay", "Pay", "pay"], ["career", "Career", "career"],
  ["culture", "Culture", "culture"], ["company", "Company", "company"], ["kit", "Kit", "kit"], ["scores", "Scores", "scores"],
];
const SNIPPET_LABEL: Record<string, string> = {
  culture: "Culture", pay_band: "Pay", scheme_structure: "Scheme", process: "Process", hybrid_policy: "Hybrid", london_office: "London office",
};
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
/** "Hybrid: three days a week in the London office." → 3 */
function officeDays(text: string): number | null {
  const m = text.match(/\b(\d|one|two|three|four|five) days?\b/i);
  return m ? (NUM[m[1].toLowerCase()] ?? Number(m[1])) : null;
}
/** A tile-sized work pattern: "Hybrid · 3 days", else the claim's first clause. */
function workPattern(text: string): string {
  const n = officeDays(text);
  if (n) return `${/remote/i.test(text) && !/hybrid/i.test(text) ? "Remote" : "Hybrid"} · ${n} day${n === 1 ? "" : "s"}`;
  return text.split(/[.:,(]/)[0].trim().slice(0, 28);
}

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(Number(id));
  if (!job) notFound();

  const jobFacts = factsFor("job", job.id).filter((f) => !f.field.startsWith("dr."));
  const coFacts = factsFor("company", job.companyId).filter((f) => !f.field.startsWith("dr."));
  const glance = companyGlance(job.companyId);
  const activity = job.applicationId ? activityFor(job.applicationId) : [];
  const answers = job.applicationId ? listAnswers(job.applicationId) : [];
  const runs = latestRuns(job.id);
  const ev = getEvaluation(job.id);
  const research = researchFor(job.id, job.companyId);
  const rr = research.row;
  const researched = !!rr;
  const claims = (s: string) => research.claims.filter((c) => c.section === s);
  const claim = (s: string, key: string) => research.claims.find((c) => c.section === s && c.key === key);
  const searched = (s: string) => rr?.unknowns.filter((u) => u.section === s).map((u) => u.searched) ?? [];

  const loc = locationParts(job.locationRaw);
  // the extracted deadline can be missing when the posting has one (Monzo's "18:00 PM on 27 September"): fall back
  // to a sourced research claim with an ISO date, and say so
  const drDeadline = job.deadline ? null : research.claims.find((c) => c.section === "process" && c.key === "deadline" && ISO.test(c.value ?? ""));
  const deadline = job.deadline ?? drDeadline?.value ?? null;
  const d = daysUntil(deadline);
  const tier = deadlineTier(deadline);
  const req = job.applicationRequirements;
  const elig = job.eligibility;
  const wiki = coFacts.find((f) => f.field === "what_they_do" && f.sourceKind === "wikipedia");
  const payFact = find(jobFacts, "pay_band") ?? find(jobFacts, "salary_text");
  const startFact = find(jobFacts, "start_text");
  const eligFact = find(jobFacts, "eligibility");
  const intake = intakeStatus({ title: job.title, startText: job.startText, description: job.descriptionText });
  if (intake.status === "unknown" && job.intakeStatus === "confirmed") { intake.status = "confirmed"; intake.why = "the employer's own page says 2027"; }
  // the posting may never say 2027 while the employer's own page does: a sourced research start date settles it
  const researchStart = research.claims.find((c) => c.section === "process" && c.key === "start");
  if (intake.status === "unknown" && researchStart && /2027/.test(`${researchStart.text} ${researchStart.value ?? ""}`)) {
    intake.status = "confirmed"; intake.why = `the research found a 2027 start (${hostOf(researchStart.sourceUrl)})`;
  }
  const liveFact = find(jobFacts, "liveness");
  const live = liveFact ? liveness(liveFact.valueJson) : null;
  const lines = rankLines(job.rankBreakdown);
  const maxAbs = Math.max(1, ...lines.map((l) => Math.abs(l.value)));
  const applyHref = job.applyUrl ?? job.canonicalUrl ?? job.sourceLinks[0]?.url ?? null;
  const postingSrc = job.canonicalUrl ?? job.sourceLinks[0]?.url ?? null;

  // ---- key facts
  const basePay = claim("pay", "base_salary");
  const fastest = [...research.commutes].sort((a, b) => a.minutes - b.minutes)[0];
  const hybrid = claim("culture", "hybrid");
  const officeClaim = research.claims.find((c) => c.section === "office" && c.key === "address");
  const facts: KeyFact[] = [
    { label: "Deadline", tone: tier === "open" || tier === "past" ? "neutral" : tier, icon: <IconClock />,
      value: d === null ? "None given" : d < 0 ? "Closed" : d === 0 ? "Today" : `${d} day${d === 1 ? "" : "s"}`,
      sub: deadline ? <>{fmtDate(deadline)}{drDeadline ? " · from research" : ""}</> : "the posting names no closing date" },
    { label: "Pay", tone: "pay", icon: <IconPay />,
      // research values come as plain numbers ("45000") or already formatted ("£48k", "£30–40k")
      value: basePay?.value ? (/^\d+$/.test(basePay.value) ? `£${Math.round(Number(basePay.value) / 1000)}k` : basePay.value) : job.salaryText ? job.salaryText.replace(/ per annum| per year/i, "") : "Not published",
      sub: basePay ? "base, from the posting" : job.salaryText ? "the posting" : undefined },
    { label: "Starts", tone: "start", icon: <IconStart />,
      value: job.startText ?? researchStart?.text.replace(/\.$/, "") ?? "Not stated",
      sub: intake.status === "unknown" ? "2027 intake not confirmed" : !job.startText && researchStart ? "from research" : undefined },
    fastest
      ? { label: "Commute", tone: "company", icon: <IconTrain />, value: `${fastest.minutes} min`, sub: `from ${fastest.from} · ${fastest.office}` }
      : { label: "Office", tone: "company", icon: <IconPin />, value: loc.primary },
    { label: "Work pattern", tone: "culture", icon: <IconMode />,
      value: hybrid ? workPattern(hybrid.text) : job.workMode !== "unknown" ? job.workMode : "Not stated",
      sub: hybrid && officeDays(hybrid.text) ? "in the office each week" : undefined },
  ];

  // ---- process timeline: deadline, the stages (research first, else the posting's list), the start
  const stageClaims = claims("process").filter((c) => /^stage_/.test(c.key)).sort((a, b) => a.key.localeCompare(b.key));
  const timeline: TimelineItem[] = [];
  if (deadline) timeline.push({ when: fmtDate(deadline), title: "Applications close", tone: "hot", claim: claim("process", "deadline") ?? undefined,
    text: claim("process", "deadline")?.text ?? job.deadlineText ?? undefined });
  if (stageClaims.length) {
    stageClaims.forEach((c, i) => timeline.push({ title: `Stage ${i + 1}`, text: c.text.replace(/^Stage \d+: ?/, ""), claim: c,
      when: c.value && ISO.test(c.value) ? fmtDate(c.value) : null }));
  } else {
    job.processStages.forEach((s, i) => timeline.push({ title: `Stage ${i + 1}`, text: s }));
  }
  const startClaim = claim("process", "start");
  if (startClaim || job.startText) timeline.push({ title: "You start", text: startClaim?.text ?? job.startText ?? undefined, claim: startClaim ?? undefined, tone: "go" });
  const rules = claims("process").filter((c) => !/^stage_/.test(c.key) && c.key !== "deadline" && c.key !== "start");

  // ---- company
  const g1 = (f: string) => glance[f]?.[0];
  const tiles = [
    { label: "Sector", value: <>{sectorLabel(job.sector)} <AiDots level={job.aiForward} /></>, fact: g1("sector") },
    ...(["headcount", "revenue", "review_rating", "competitiveness", "funding"] as const)
      .filter((f) => g1(f)).map((f) => ({
        label: { headcount: "Size", revenue: "Revenue", review_rating: "Employee rating", competitiveness: "Competition", funding: "Funding" }[f],
        value: g1(f)!.value.replace(/ \((Indeed|higherin)\)/, ""), fact: g1(f),
      })),
  ];
  // research claims carrying a short figure (revenue, users, staff, founded) become stat tiles too
  for (const c of research.claims) {
    if ((c.section === "company" || c.section === "news") && c.value && c.value.length <= 16 && !ISO.test(c.value)) {
      tiles.push({ label: c.key.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase()), value: c.value,
        fact: { value: c.value, sourceUrl: c.sourceUrl, sourceKind: c.sourceKind, confidence: c.confidence } });
    }
  }
  // a short claim that became a tile says nothing more as a card
  const ownWords = claims("company").filter((c) => !(c.value && c.value.length <= 16 && c.text.length < 60));
  const snippets = Object.entries(SNIPPET_LABEL).flatMap(([f, label]) => (glance[f] ?? []).slice(0, 1).map((fact) => ({ label, fact })));
  if (job.aiForwardRationale) {
    const ai = glance.ai_forward?.[0];
    if (ai) snippets.unshift({ label: "AI use", fact: { ...ai, value: job.aiForwardRationale } });
  }

  const evRows = ev ? (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).map((k) => ({ label: SCORE_LABEL[k], score: ev.scores[k] ?? null, reason: ev.reasons[k], weight: WEIGHTS[k] })) : [];

  return (
    <PageSlide>
    <main className="wrap ff rp" style={{ "--sec": sectorColor(job.sector) } as React.CSSProperties}>
      <p className="crumb">
        <Link href="/" transitionTypes={["nav-back"]}>Roles</Link> · <Link href={`/companies/${job.companySlug}`} transitionTypes={["nav-forward"]}>{job.company}</Link>
      </p>

      <header className="rp-hero">
        <div className="ffh">
          <Logo company={{ name: job.company, logoUrl: job.logoUrl, domain: job.domain }} size={52} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="ffco">
              <i />
              <Link href={`/companies/${job.companySlug}`} transitionTypes={["nav-forward"]}>{job.company}</Link>
              <span>· {sectorLabel(job.sector)}</span>
              <AiDots level={job.aiForward} />
            </div>
            <h1>{job.title}</h1>
            <div className="chips">
              <span className="c">{kindLabel(job.kind)}</span>
              {job.excludedReason ? <span className="c c--hot">Filtered out: {job.excludedReason}</span> : null}
              {job.status === "closed" ? <span className="c c--hot">You marked this closed: it&apos;s in the Applications archive</span> : null}
            </div>
          </div>
          <div className="rp-side">
            <FitRing score={job.rankScore} rankPos={job.rankPos} size={64} />
            {applyHref ? (
              <a className="btn btn--go rp-cta" href={applyHref} target="_blank" rel="noreferrer">
                Open posting <IconExternal width={13} height={13} />
              </a>
            ) : null}
            {!["closed", "rejected", "dismissed"].includes(job.status ?? "") ? (
              <NotInterested variant="hero" jobId={job.id} company={job.company} status={job.status} />
            ) : null}
          </div>
        </div>
        <div className="rp-trk">
          <StageTrack jobId={job.id} status={job.status ?? "discovered"} company={job.company} />
        </div>
        {job.status && !["discovered", "closed", "rejected", "dismissed"].includes(job.status) ? (
          <div className="rp-next">
            <NextStep jobId={job.id} text={job.nextAction} due={job.nextActionDue} status={job.status} appliedAt={job.appliedAt ?? null} />
          </div>
        ) : null}
        <RunPanel
          jobId={job.id}
          runs={runs.map((r) => ({ id: r.id, kind: r.kind, state: r.state, note: r.note, error: r.error, formUrl: r.formUrl, costUsd: runUsage(r.id).costUsd }))}
          questions={runs.filter((r) => r.state === "needs_you").flatMap((r) => openQuestions(r.id))
            .map((q) => ({ id: q.id, runId: q.runId, kind: q.kind, prompt: q.prompt, options: q.options, standing: q.standing }))}
        />
        <KeyFacts facts={facts} />
      </header>

      <nav className="toc" aria-label="Sections">
        {TOC.map(([id, label, acc]) => <a key={id} href={`#${id}`} data-acc={acc}>{label}</a>)}
      </nav>
      <p className="rs-state">
        {researched
          ? <>Researched {fmtDate(rr!.researchedAt.slice(0, 10))} · {research.claims.length} sourced claims (hover a source for its quote) ·{" "}
              <Judgement /> marks judgement, not fact</>
          : <>Not researched yet: only the posting and Claude&apos;s evaluation below.</>}
      </p>

      {/* 1 — the job */}
      <Section id="do" acc="job" icon={<IconBriefcase />} title="What you'd actually do" researched={researched}
               searched={searched("role")} hasContent={!!ev || claims("role").length > 0} fromPosting={!!ev}>
        {ev ? (
          <div className="card card--lead">
            <p className="rp-lead">{ev.oneLine} <Judgement /></p>
            <p className="prose">{ev.dayToDay}</p>
            {ev.dealbreakers.length ? (
              <div className="warn"><IconWarn /><span><b>Dealbreaker.</b>{" "}
                {ev.dealbreakers.map((x) => `${DEALBREAKER_LABEL[x.kind] ?? x.kind}: ${x.evidence}`).join(" · ")}</span></div>
            ) : null}
          </div>
        ) : null}
        <ClaimCards claims={claims("role")} />
      </Section>

      {/* 2 — can you get it */}
      <Section id="chance" acc="chance" icon={<IconTarget />} title="Can you get it" researched={researched}
               searched={searched("requirements")} hasContent fromPosting>
        {rr?.fit.length ? <FitMeter fit={rr.fit} /> : null}
        <div className="two">
          <div className="card">
            <h3 className="card-h">They ask for</h3>
            {claims("requirements").length ? null : <dl className="kv">
              <div><dt>Degree</dt>{elig?.degree_class
                ? <dd>{elig.degree_class}+{eligFact ? <SourceLink url={eligFact.sourceUrl} kind={eligFact.sourceKind} confidence={eligFact.confidence} /> : null}</dd>
                : <dd className="nf">No class stated</dd>}</div>
              <div><dt>Subjects</dt>{elig?.subjects?.length ? <dd>{elig.subjects.join(", ")}</dd> : <dd className="nf">Any / not stated</dd>}</div>
              {elig?.visa_sponsorship && elig.visa_sponsorship !== "unknown"
                ? <div><dt>Visa</dt><dd>{elig.visa_sponsorship ? "Sponsored" : "No sponsorship"}</dd></div> : null}
            </dl>}
            <ClaimCards claims={claims("requirements")} cols="one" />
          </div>
          <div className="card">
            <h3 className="card-h">You <Judgement /></h3>
            {rr?.fit.length ? <FitList fit={rr.fit} /> : <Unknown researched={false} />}
            {ev?.stretch ? <p className="note"><b>Stretch:</b> {ev.stretch}</p> : null}
            {ev && ev.gradRole !== "yes" ? <p className="note"><b>Grad role? {ev.gradRole}:</b> {ev.gradRoleReason}</p> : null}
          </div>
        </div>
      </Section>

      {/* 2b — what they look for: their values as behaviours, a glance before tests and interviews */}
      {claims("values").length ? (
        // the heading sits in the cards' left column (ValueCards), centred against them
        <section id="values" className="rs" data-acc="values">
          <ValueCards values={claims("values").map((v) => ({ key: v.key, text: v.text, story: v.story ?? null }))} />
        </section>
      ) : (
        <Section id="values" acc="values" icon={<IconHeart />} title="What they look for" researched={false} hasContent={false} />
      )}

      {/* 3 — your angle */}
      <section id="angle" className="rs" data-acc="angle">
        <h2 className="rs-h"><span className="rs-ic" aria-hidden><IconSpark /></span>Your angle <Judgement /></h2>
        {rr ? (
          <>
            <blockquote className="hook">{rr.angle.hook}</blockquote>
            <div className="two">
              {rr.angle.stories.length ? (
                <div className="card">
                  <h3 className="card-h">Stories that fit <span className="n">from stories.md</span></h3>
                  <ol className="stories">
                    {rr.angle.stories.map((s, i) => <li key={i}><b>{s.story.replace(/^\d+\.\s*/, "")}</b><span>{s.why}</span></li>)}
                  </ol>
                </div>
              ) : null}
              {rr.angle.openQuestions.length ? (
                <div className="card card--warn">
                  <h3 className="card-h"><IconWarn width={13} height={13} /> Answer before applying</h3>
                  <ul className="todo">{rr.angle.openQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul>
                </div>
              ) : null}
            </div>
          </>
        ) : <Unknown researched={false} />}
      </section>

      {/* 4 — process */}
      <Section id="process" acc="process" icon={<IconRoute />} title="Process & dates" researched={researched}
               searched={searched("process")} hasContent fromPosting>
        <div className="two two--wide">
          <div className="card">
            <h3 className="card-h">Timeline</h3>
            {timeline.length ? <Timeline items={timeline} /> : <p className="nf">No stages or dates in the posting.</p>}
            {live ? <p className="note">Still open? <b>{live.status === "open" ? "Yes" : live.status === "closed" ? "Closed" : "Couldn't verify"}</b>{" "}
              <span className="nf">· {live.evidence} · checked {fmtDate(live.checkedAt)}</span>
              <SourceLink url={liveFact!.sourceUrl} kind={liveFact!.sourceKind} confidence={liveFact!.confidence} /></p> : null}
          </div>
          <div className="stack">
            {rules.length ? (
              <div className="card card--warn">
                <h3 className="card-h"><IconWarn width={13} height={13} /> Rules to know</h3>
                <ClaimCards claims={rules} cols="one" />
              </div>
            ) : null}
            <div className="card">
              <h3 className="card-h">The posting asks for</h3>
              <div className="board board--sm">
                {REQ_FIELDS.map(([key, label]) => {
                  const st = reqState(req?.[key as keyof typeof req]);
                  const Icon = REQ_ICON[key as keyof typeof REQ_ICON];
                  return (
                    <div key={key} className={`bx${st === "yes" ? " bx--on" : ""}`}>
                      <Icon /><span className="bl">{label}</span><span className="bs">{reqWord(st)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* 5 — pay */}
      <Section id="pay" acc="pay" icon={<IconPay />} title="Pay & benefits" researched={researched}
               searched={searched("pay")} hasContent={!!job.salaryText || claims("pay").length > 0} fromPosting={!!job.salaryText}>
        {job.salaryText ? (
          <p className="big">{job.salaryText}
            {payFact ? <SourceLink url={payFact.sourceUrl} kind={payFact.sourceKind} confidence={payFact.confidence} /> : null}</p>
        ) : null}
        <ClaimCards claims={claims("pay")} />
      </Section>

      {/* 6 — career path */}
      <Section id="career" acc="career" icon={<IconTrend />} title="Where it could lead" note="the next 5–7 years"
               researched={researched} searched={searched("career")} hasContent={!!rr?.careerPath || claims("career").length > 0}>
        {rr?.careerPath ? <CareerFlow path={rr.careerPath} /> : null}
        {claims("career").length ? <><h3 className="sub-h">What the employer says</h3><ClaimCards claims={claims("career")} /></> : null}
      </Section>

      {/* 7 — culture */}
      <Section id="culture" acc="culture" icon={<IconClock />} title="Hours & culture" researched={researched}
               searched={searched("culture")} hasContent={claims("culture").length > 0 || job.workMode !== "unknown"}>
        <ClaimCards claims={claims("culture")} />
      </Section>

      {/* 8 — company */}
      <section id="company" className="rs" data-acc="company">
        <h2 className="rs-h"><span className="rs-ic" aria-hidden><IconBuilding /></span>About {job.company}</h2>
        <div className="card co">
          <div className="co-h">
            <Logo company={{ name: job.company, logoUrl: job.logoUrl, domain: job.domain }} size={40} />
            <div>
              {job.companySummary ? <p className="prose">{job.companySummary}</p> : <p className="nf">No verified summary yet.</p>}
              {wiki ? <p className="co-src">Summary from{" "}
                <a className="src" href={wiki.sourceUrl} target="_blank" rel="noreferrer">{hostOf(wiki.sourceUrl)}{new URL(wiki.sourceUrl).pathname.replace("/wiki/", "/")}</a>
                {" "}· check it&apos;s this employer</p> : null}
            </div>
          </div>
          <GlanceTiles tiles={tiles} />
        </div>

        {ownWords.length ? <><h3 className="sub-h">In their own words</h3><ClaimCards claims={ownWords} /></> : null}

        <div className="two">
          <div className="card" id="news">
            <h3 className="card-h"><IconNews width={13} height={13} /> Recent news <span className="n">checked to be this employer</span></h3>
            {claims("news").length ? <NewsTimeline claims={claims("news")} /> : <Unknown researched={researched} searched={searched("news")} />}
          </div>
          <div className="card" id="office">
            <h3 className="card-h"><IconTrain width={13} height={13} /> Office & journey</h3>
            {officeClaim ? <p className="addr">{officeClaim.text.split(/\. |\(/)[0].replace(/\.$/, "")}</p> : <p className="addr">{loc.primary}</p>}
            <CommuteBars commutes={research.commutes} />
            {researched && !research.commutes.length ? <p className="nf">No office postcode found, so no journey time.</p> : null}
            <ClaimCards claims={claims("office").filter((c) => c !== officeClaim)} cols="one" />
            {loc.others.length ? <p className="nf">The posting also lists {loc.others.join(", ")}.</p> : null}
          </div>
        </div>

        {snippets.length ? (
          <details className="disc">
            <summary><IconChevron />What automated web search found <span className="cnt">{snippets.length} snippets · low confidence</span></summary>
            <div className="dbody"><Snippets items={snippets} /></div>
          </details>
        ) : null}
      </section>

      {/* 9 — kit */}
      <section id="kit" className="rs" data-acc="kit">
        <h2 className="rs-h"><span className="rs-ic" aria-hidden><IconFolder /></span>Application kit</h2>
        <div className="kit">
          <div className="kit-i"><span>CV</span><b className="nf">Base CV only</b></div>
          <div className="kit-i"><span>Cover letter</span><b className="nf">Not drafted</b></div>
          <div className="kit-i"><span>Answers</span>{answers.length
            ? <b>{answers.filter((a) => a.status !== "draft").length} approved · {answers.filter((a) => a.status === "draft").length} draft</b>
            : <b className="nf">None yet</b>}</div>
        </div>
        {answers.length ? <AnswersPanel jobId={job.id} answers={answers} /> : null}
        <TrackerPanel jobId={job.id} status={job.status} notes={job.notes} activity={activity} />
      </section>

      {/* 10 — scores */}
      <section id="scores" className="rs" data-acc="scores">
        <h2 className="rs-h"><span className="rs-ic" aria-hidden><IconChart /></span>How it scores <Judgement />
          <span className="n">fit {Math.max(0, Math.round(job.rankScore))}/100 · rank {job.rankPos ?? "–"} of every kept role</span></h2>
        {ev ? <ScoreBars rows={evRows} /> : <p className="nf">Not evaluated yet.</p>}
        {ev ? <p className="nf ev-meta">Evaluated {fmtDate(ev.evaluatedAt.slice(0, 10))} by {ev.model} · confidence {ev.confidence}</p> : null}
        {lines.length ? (
          <details className="disc">
            <summary><IconChevron />Fit {job.rankScore}, line by line<span className="cnt">{lines.length} parts</span></summary>
            <div className="dbody">
              <div className="bars">
                {lines.map((l) => (
                  <div className="bar" key={l.key}>
                    <span>{l.label}</span>
                    <span className="tr"><span className={`fi${l.value === 0 ? " zero" : l.value < 0 ? " neg" : ""}`}
                                                style={{ width: `${(Math.abs(l.value) / maxAbs) * 100}%` }} /></span>
                    <b>{l.value > 0 ? "+" : ""}{l.value}</b>
                  </div>
                ))}
              </div>
            </div>
          </details>
        ) : null}
      </section>

      <div className="rs-tail">
        <SourcesDrawer claims={research.claims} label="Sources & quotes for every claim" />
        {jobFacts.length ? (
          <details className="disc">
            <summary><IconChevron />Posting facts from extraction<span className="cnt">{jobFacts.length} rows</span></summary>
            <div className="dbody">{jobFacts.map((f, i) => <FactLine key={i} fact={f} />)}</div>
          </details>
        ) : null}
        {job.descriptionText ? (
          <details className="disc">
            <summary><IconChevron />Posting text<span className="cnt">{job.descriptionText.length.toLocaleString("en-GB")} characters</span></summary>
            <div className="dbody"><div className="prose">
              {job.descriptionText.split(/\n{2,}/).filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}
            </div></div>
          </details>
        ) : null}
      </div>

      <div className="prov">
        <b>Provenance.</b> Seen on {job.sourceLinks.length
          ? job.sourceLinks.map((s, i) => <span key={s.source}>{i ? " and " : ""}<a className="src" href={s.url} target="_blank" rel="noreferrer">{s.source}</a></span>)
          : "—"} · first seen {fmtDate(job.firstSeen.slice(0, 10))}
        {postingSrc ? <> · posting <a className="src" href={postingSrc} target="_blank" rel="noreferrer">{hostOf(postingSrc)}</a></> : null}
        {job.extractionMeta ? <> · extracted by <code>{job.extractionMeta.provider}/{job.extractionMeta.model}</code></> : <> · <b>not yet extracted</b></>}
        {fastest ? <> · journeys: TfL, departing {fastest.departs}</> : null}.
        Facts come from the posting or a <code>facts</code> row with a source; “Claude&apos;s read” marks judgement.
      </div>
      <UndoToast />
    </main>
    </PageSlide>
  );
}
