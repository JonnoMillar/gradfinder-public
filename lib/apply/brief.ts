/**
 * Research brief for one role: everything gradfinder knows about the posting and the employer, every line carrying
 * its source URL, as Markdown. Deterministic — no LLM here. It is the grounding a drafting run (with the voice guide)
 * is allowed to cite for "why us / why this role"; anything not in the brief must be researched with a source or
 * left out. Written to profile/research/ (gitignored) by `npm run brief -- <jobId>`.
 */
import { factsFor, getJob, newsForCompany } from "@/lib/queries";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const tri = (v: unknown) => (v === true ? "yes" : v === false ? "no" : "not stated");

export function buildBrief(jobId: number, today = new Date().toISOString().slice(0, 10)): { markdown: string; fileName: string } | null {
  const j = getJob(jobId);
  if (!j) return null;
  const postingUrl = j.canonicalUrl ?? j.sourceLinks[0]?.url ?? j.applyUrl ?? "(no URL stored)";
  const jobFacts = factsFor("job", j.id);
  const coFacts = factsFor("company", j.companyId);
  const news = newsForCompany(j.companyId, 10);
  const L: string[] = [];

  L.push(`# Research brief: ${j.company} · ${j.title}`, "");
  L.push(`Generated ${today} by \`npm run brief -- ${j.id}\` from gradfinder's database. Each line names its source.`,
    "Anything not in this brief is NOT known. Research it with a source URL, or leave it out of the answer.", "");

  L.push("## The role", "");
  L.push(`- Title: ${j.title} (${j.kind.replace(/_/g, " ")}), job #${j.id}`);
  L.push(`- Location: ${j.locationRaw ?? "not stated"} · work mode: ${j.workMode}`);
  L.push(`- Deadline: ${j.deadline ?? "not stated"}${j.deadlineText ? ` ("${j.deadlineText}")` : ""}`);
  L.push(`- Pay: ${j.salaryText ?? "not stated"} · start: ${j.startText ?? "not stated"} · 2027 intake: ${j.intakeStatus ?? "unknown"}`);
  L.push(`- Apply: ${j.applyUrl ?? "not stored"}`);
  for (const s of j.sourceLinks) L.push(`- Posting (${s.source}): ${s.url}`);
  if (j.status) L.push(`- Tracker: ${j.status}${j.nextAction ? `; next: ${j.nextAction}` : ""}`);
  L.push("");

  L.push(`## What the posting asks for (source: ${postingUrl})`, "");
  const e = j.eligibility, r = j.applicationRequirements;
  L.push(`- Degree class: ${e?.degree_class ?? "not stated"} · subjects: ${e?.subjects?.length ? e.subjects.join(", ") : "any / not stated"} · visa sponsorship: ${tri(e?.visa_sponsorship)}`);
  if (e?.other?.length) L.push(`- Other eligibility: ${e.other.join("; ")}`);
  if (r) {
    L.push(`- CV: ${tri(r.cv)} · cover letter: ${tri(r.cover_letter)} · motivational questions: ${tri(r.motivational_questions)} · video interview: ${tri(r.video_interview)} · online tests: ${tri(r.online_tests)} · assessment centre: ${tri(r.assessment_centre)}`);
    if (r.other?.length) L.push(`- Other requirements: ${r.other.join("; ")}`);
  }
  if (j.processStages.length) L.push(`- Process: ${j.processStages.join(" → ")}`);
  L.push("");

  if (jobFacts.length) {
    L.push("## Facts extracted from the posting", "");
    for (const f of jobFacts) L.push(`- ${f.field}: ${clip(f.valueText, 300)} (${f.sourceKind}, ${f.confidence}; ${f.sourceUrl})`);
    L.push("");
  }

  L.push(`## ${j.company}`, "");
  if (j.companySummary) L.push(`${j.companySummary}`, "", "(Summary source: the company's Wikipedia/research facts below.)", "");
  for (const f of coFacts) L.push(`- ${f.field}: ${clip(f.valueText, 400)} (${f.sourceKind}, ${f.confidence}; ${f.sourceUrl})`);
  if (!coFacts.length && !j.companySummary) L.push("- Not researched yet. Run `npm run research` or research it by hand, with sources.");
  L.push("");

  // Stored news is fetched by company NAME and is often about something else: all 10 headlines for one employer on
  // 2026-09-23 were a police appeal, a town and a scientist who shared its name. Headlines are not grounding, so none go in the brief.
  L.push("## Recent news", "",
    `- Not included: gradfinder's stored headlines are matched by name only and are unreliable (${news.length} stored).`,
    "  For a news hook, search for the company's own newsroom or a named outlet, open the article, and cite its URL.", "");

  if (j.descriptionText) {
    L.push(`## Posting text (source: ${postingUrl})`, "", clip(j.descriptionText.replace(/\n{3,}/g, "\n\n"), 6000), "");
  }

  const slug = `${j.companySlug}-${j.id}`;
  return { markdown: L.join("\n"), fileName: `${slug}.md` };
}
