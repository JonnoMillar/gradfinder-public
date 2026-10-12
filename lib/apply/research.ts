/**
 * Deep research on one role (v2 step 3). A Claude session researches the role on the web (runbook:
 * docs/automation/research-role.md) and writes a JSON file; `npm run deep -- import` validates it here.
 *
 * Every claim about the employer or the role becomes a `facts` row with its `source_url` (field
 * `dr.<section>.<key>`, value_json.via = "claude_research"), so the page can show a source next to each line.
 * A section with nothing found must say what was searched (`unknowns`): the page then shows an honest "unknown"
 * instead of an empty space. The input is rejected if a section has neither.
 *
 * What is NOT a sourced fact (Claude's read of the requirements against Jonno's knowledge store, and which of his
 * stories fit) goes in `role_research`, and the page labels it as Claude's judgement.
 *
 * Office journey times come from the free TfL Journey Planner API (no key), not from the researcher.
 */
import { and, eq, like, notLike } from "drizzle-orm";
import { z } from "zod";
import { getDb, getSqlite, schema } from "@/lib/db/client";
import { COMMUTE_FROM } from "@/config/criteria";

export const SECTIONS = ["role", "requirements", "pay", "career", "culture", "process", "company", "news", "office"] as const;
export type Section = (typeof SECTIONS)[number];
export const SECTION_LABEL: Record<Section, string> = {
  role: "What you'd actually do", requirements: "Requirements", pay: "Pay & benefits", career: "Career path",
  culture: "Hours & culture", process: "Process & dates", company: "Company", news: "Recent news", office: "Office",
};
/** Wikipedia is left out on purpose: `npm run research` deletes every wikipedia-kind company fact when it re-runs. */
const RESEARCH_SOURCE_KINDS = ["posting", "company_site", "news", "reviews", "search_snippet", "ats"] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const httpUrl = z.string().url().refine((u) => /^https?:\/\//.test(u), "http(s) URL");

export const Claim = z.object({
  section: z.enum(SECTIONS),
  /** company-level claims are shared by every role at the employer; job-level ones belong to this role */
  about: z.enum(["job", "company"]),
  key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, "snake_case key"),
  text: z.string().trim().min(3).max(600),
  /** the sentence on the source page that supports the claim, verbatim (≤ 500 chars) */
  quote: z.string().trim().max(500).nullable(),
  /** a machine value where one helps: the office postcode, an ISO date, a number */
  value: z.string().trim().max(120).nullable().optional(),
  sourceUrl: httpUrl,
  sourceKind: z.enum(RESEARCH_SOURCE_KINDS),
  confidence: z.enum(["high", "medium", "low"]),
  publishedAt: isoDate.nullable().optional(),
}).strict().superRefine((c, ctx) => {
  if (c.section === "news" && !c.publishedAt) ctx.addIssue({ code: "custom", message: "a news claim needs publishedAt" });
});
export type Claim = z.infer<typeof Claim>;

const CareerStep = z.object({
  title: z.string().trim().min(3).max(60),
  years: z.string().trim().min(1).max(12),
  /** £k a year, base pay in London; a rough estimate, labelled as such on the page */
  payLow: z.number().min(15).max(500),
  payHigh: z.number().min(15).max(500),
  note: z.string().trim().max(120).nullable().optional(),
}).strict().refine((s) => s.payHigh >= s.payLow, "payHigh must be ≥ payLow");

/** Claude's rough read of where the role could lead (Jonno, 2026-09-25: "just give a rough idea"). */
export const CareerPathInput = z.object({
  start: CareerStep,
  tracks: z.array(z.object({
    name: z.string().trim().min(3).max(40),
    why: z.string().trim().min(5).max(160),
    steps: z.array(CareerStep).min(1).max(3),
  }).strict()).min(2).max(4),
  /** what the estimate leans on: the posting's pay, sourced claims, general market knowledge */
  basis: z.string().trim().min(10).max(300),
}).strict();

export const ResearchInput = z.object({
  jobId: z.number().int().positive(),
  claims: z.array(Claim).min(1).max(120),
  unknowns: z.array(z.object({ section: z.enum(SECTIONS), searched: z.string().trim().min(5).max(400) }).strict()).max(20),
  fit: z.array(z.object({
    requirement: z.string().trim().min(3).max(200),
    status: z.enum(["meets", "stretch", "gap", "unconfirmed"]),
    /** what in Jonno's knowledge store supports the status (or what is missing from it) */
    evidence: z.string().trim().min(3).max(400),
  }).strict()).min(1).max(20),
  angle: z.object({
    stories: z.array(z.object({ story: z.string().trim().min(3).max(120), why: z.string().trim().min(3).max(300) }).strict()).max(6),
    hook: z.string().trim().min(10).max(600),
    openQuestions: z.array(z.string().trim().min(5).max(300)).max(10),
  }).strict(),
  careerPath: CareerPathInput.nullable().optional(),
}).strict().superRefine((r, ctx) => {
  const covered = new Set<string>([...r.claims.map((c) => c.section), ...r.unknowns.map((u) => u.section)]);
  const missing = SECTIONS.filter((s) => !covered.has(s));
  if (missing.length) ctx.addIssue({ code: "custom", message: `no claim and no "unknowns" entry for: ${missing.join(", ")}` });
});
export type ResearchInput = z.infer<typeof ResearchInput>;

export function saveResearch(raw: unknown, model: string): { jobId: number; claims: number; result: "inserted" | "replaced" } {
  const r = ResearchInput.parse(raw);
  const db = getDb();
  const job = db.select({ id: schema.jobs.id, companyId: schema.jobs.companyId }).from(schema.jobs).where(eq(schema.jobs.id, r.jobId)).get();
  if (!job) throw new Error(`job ${r.jobId} does not exist`);
  const hasCompanyClaims = r.claims.some((c) => c.about === "company");

  return db.transaction((tx) => {
    const dr = like(schema.facts.field, "dr.%");
    tx.delete(schema.facts).where(and(eq(schema.facts.entityType, "job"), eq(schema.facts.entityId, job.id), dr)).run();
    // company claims are replaced only by a research run that has some: researching a second role at the same
    // employer with job-only claims must not wipe the first run's company research
    if (hasCompanyClaims) tx.delete(schema.facts).where(and(eq(schema.facts.entityType, "company"), eq(schema.facts.entityId, job.companyId), dr,
      notLike(schema.facts.field, "dr.values.%"))).run(); // values have their own import (saveValues)
    const at = new Date().toISOString();
    for (const c of r.claims) {
      tx.insert(schema.facts).values({
        entityType: c.about, entityId: c.about === "job" ? job.id : job.companyId,
        field: `dr.${c.section}.${c.key}`, valueText: c.text,
        valueJson: { via: "claude_research", section: c.section, key: c.key, quote: c.quote, value: c.value ?? null, publishedAt: c.publishedAt ?? null },
        sourceUrl: c.sourceUrl, sourceKind: c.sourceKind, confidence: c.confidence, fetchedAt: at,
      }).run();
    }
    const row = { jobId: job.id, unknowns: r.unknowns, fit: r.fit, angle: r.angle, careerPath: r.careerPath ?? null, model, researchedAt: at };
    const existing = tx.select({ id: schema.roleResearch.id }).from(schema.roleResearch).where(eq(schema.roleResearch.jobId, job.id)).get();
    if (existing) tx.update(schema.roleResearch).set(row).where(eq(schema.roleResearch.id, existing.id)).run();
    else tx.insert(schema.roleResearch).values(row).run();
    return { jobId: job.id, claims: r.claims.length, result: existing ? "replaced" as const : "inserted" as const };
  });
}

// ---------- employer values (Jonno, 2026-10-09) ----------

/**
 * The employer's values, each phrased as the behaviour they want to see ("Taking ownership of your work"), for a quick
 * read before personality tests, video interviews and interviews. Company-level `dr.values.<key>` facts, so every role
 * at the employer shows them. The label is Claude's wording; the quote is the employer's own sentence and the source
 * its page. `story` is Claude's pick of one of Jonno's story titles (judgement, not fact). Its own import, so a deep
 * research run and a values run never wipe each other.
 */
export const ValuesInput = z.object({
  company: z.string().regex(/^[a-z0-9-]+$/, "company slug"),
  values: z.array(z.object({
    key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, "snake_case key"),
    label: z.string().trim().min(3).max(70),
    quote: z.string().trim().min(3).max(500),
    sourceUrl: httpUrl,
    sourceKind: z.enum(RESEARCH_SOURCE_KINDS),
    confidence: z.enum(["high", "medium", "low"]),
    story: z.string().trim().min(3).max(60).nullable().optional(),
  }).strict()).min(3).max(5),
}).strict().refine((v) => new Set(v.values.map((x) => x.key)).size === v.values.length, "duplicate key");
export type ValuesInput = z.infer<typeof ValuesInput>;

export function saveValues(raw: unknown): { company: string; values: number } {
  const v = ValuesInput.parse(raw);
  const db = getDb();
  const co = db.select({ id: schema.companies.id }).from(schema.companies).where(eq(schema.companies.slug, v.company)).get();
  if (!co) throw new Error(`company ${v.company} does not exist`);
  return db.transaction((tx) => {
    tx.delete(schema.facts).where(and(eq(schema.facts.entityType, "company"), eq(schema.facts.entityId, co.id),
      like(schema.facts.field, "dr.values.%"))).run();
    const at = new Date().toISOString();
    for (const x of v.values) {
      tx.insert(schema.facts).values({
        entityType: "company", entityId: co.id, field: `dr.values.${x.key}`, valueText: x.label,
        valueJson: { via: "claude_research", section: "values", key: x.key, quote: x.quote, value: null, story: x.story ?? null },
        sourceUrl: x.sourceUrl, sourceKind: x.sourceKind, confidence: x.confidence, fetchedAt: at,
      }).run();
    }
    return { company: v.company, values: v.values.length };
  });
}

// ---------- research queue ----------

export interface QueuedRole {
  jobId: number; company: string; title: string; rank: number; deadline: string | null;
  why: "top_rank" | "tracked"; status: string | null;
}

/**
 * Which kept roles are due deep research (agreed with Jonno 2026-09-25): the top `top` by rank, plus every role he
 * has marked interested/applying, minus those already researched. Ordered by deadline (soonest first, no deadline
 * last), so a run that runs out of usage part-way has done the time-critical ones.
 */
export function researchQueue(top = 15): QueuedRole[] {
  const rows = getSqlite().prepare(`
    with kept as (
      select j.id, c.name company, j.title, j.rank_score rank, j.deadline, a.status,
             row_number() over (order by j.rank_score desc) rn
      from jobs j join companies c on c.id = j.company_id left join applications a on a.job_id = j.id
      where j.is_active = 1 and j.excluded_reason is null)
    select k.* from kept k
    where (k.rn <= ? or k.status in ('interested', 'applying'))
      and not exists (select 1 from role_research r where r.job_id = k.id)`).all(top) as
    { id: number; company: string; title: string; rank: number; deadline: string | null; status: string | null; rn: number }[];
  return rows
    .map((r) => ({ jobId: r.id, company: r.company, title: r.title, rank: r.rank, deadline: r.deadline, status: r.status,
      why: (r.rn <= top ? "top_rank" : "tracked") as QueuedRole["why"] }))
    .sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999") || b.rank - a.rank);
}

// ---------- office journey times (TfL Journey Planner, free, no key) ----------

export interface Commute { from: string; minutes: number; summary: string; office: string; departs: string }

/** Next Monday 08:30 (or the Monday after, if today is Monday): a normal weekday rush-hour departure. */
export function nextMondayMorning(today = new Date()): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + (((8 - d.getUTCDay()) % 7) || 7));
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export function tflUrl(fromStop: string, to: string, date: string) {
  return `https://api.tfl.gov.uk/Journey/JourneyResults/${encodeURIComponent(fromStop)}/to/${encodeURIComponent(to)}` +
    `?timeIs=Departing&time=0830&date=${date}`;
}

interface TflJourney { duration: number; legs: { mode: { name: string }; instruction: { summary: string } }[] }

/** The quickest journey TfL offers, as one line ("tube: Northern line to Bank · walking: Walk to EC2R 8AH"). */
export function quickest(body: unknown): { minutes: number; summary: string } | null {
  const js = (body as { journeys?: TflJourney[] } | null)?.journeys ?? [];
  if (!js.length) return null;
  const best = js.reduce((a, b) => (b.duration < a.duration ? b : a));
  return { minutes: best.duration, summary: best.legs.map((l) => `${l.mode.name}: ${l.instruction.summary}`).join(" · ") };
}

/** The office postcode for a role: its own `dr.office.*` fact with a value, else the employer's. */
export function officeFor(jobId: number): { postcode: string; address: string } | null {
  const db = getDb();
  const job = db.select({ companyId: schema.jobs.companyId }).from(schema.jobs).where(eq(schema.jobs.id, jobId)).get();
  if (!job) return null;
  for (const [type, id] of [["job", jobId], ["company", job.companyId]] as const) {
    const rows = db.select().from(schema.facts)
      .where(and(eq(schema.facts.entityType, type), eq(schema.facts.entityId, id), like(schema.facts.field, "dr.office.%"))).all();
    for (const f of rows) {
      const v = (f.valueJson as { value?: string | null } | null)?.value;
      if (v && /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i.test(v.trim())) return { postcode: v.trim().toUpperCase(), address: f.valueText };
    }
  }
  return null;
}

/**
 * Fetches a journey time from each COMMUTE_FROM station to the role's office and stores it as a job fact
 * (`dr.commute.<station>`), replacing the previous ones. Throws when TfL returns no journey: a missing time
 * must be visible, not silently absent.
 */
export async function saveCommutes(jobId: number, fetchImpl: typeof fetch = fetch, today = new Date(), from = COMMUTE_FROM): Promise<Commute[]> {
  if (!from.length) return []; // no home stations configured (config/criteria.ts)
  const office = officeFor(jobId);
  if (!office) throw new Error(`job ${jobId}: no office postcode in its research (a dr.office.* fact with a postcode value)`);
  const date = nextMondayMorning(today);
  const out: { c: Commute; url: string }[] = [];
  for (const s of from) {
    const url = tflUrl(s.stop, office.postcode, date);
    const res = await fetchImpl(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`TfL ${res.status} for ${s.name} → ${office.postcode}`);
    const q = quickest(await res.json());
    if (!q) throw new Error(`TfL returned no journey for ${s.name} → ${office.postcode}`);
    out.push({ c: { from: s.name, ...q, office: office.postcode, departs: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)} 08:30` }, url });
  }
  const db = getDb();
  db.transaction((tx) => {
    tx.delete(schema.facts).where(and(eq(schema.facts.entityType, "job"), eq(schema.facts.entityId, jobId), like(schema.facts.field, "dr.commute.%"))).run();
    for (const { c, url } of out) {
      tx.insert(schema.facts).values({
        entityType: "job", entityId: jobId, field: `dr.commute.${c.from.toLowerCase().replace(/\W+/g, "_")}`,
        valueText: `${c.minutes} min from ${c.from}`, valueJson: { via: "tfl", ...c },
        sourceUrl: url, sourceKind: "journey_planner", confidence: "high",
      }).run();
    }
  });
  return out.map((o) => o.c);
}
