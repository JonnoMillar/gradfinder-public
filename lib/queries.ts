/**
 * Read-only queries for the UI. Imported only from server components / server actions —
 * `better-sqlite3` is native, so it can never be pulled into a client bundle.
 *
 * These read layers 2 and 3; nothing here writes. Every field the UI renders comes from a column
 * parsed off the posting or from a `facts` row carrying a `source_url` — see `factsFor`.
 */
import { eq } from "drizzle-orm";
import { defaultStep } from "@/lib/tracker/steps";
import { getDb, getSqlite, schema } from "@/lib/db/client";
import { SPORT_COMPANIES } from "@/config/criteria";
import { weekGoal, type WeekGoal } from "@/lib/tracker/goals";
import type {
  ApplicationRequirements, Eligibility, ExtractionMeta, JobKind, RoleEvaluation, RoleResearch, WorkMode,
} from "@/lib/db/schema";

function parse<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "object") return v as T;
  try { return JSON.parse(String(v)) as T; } catch { return fallback; }
}

export interface JobListRow {
  id: number;
  title: string;
  kind: JobKind;
  rankScore: number;
  deadline: string | null;
  deadlineText: string | null;
  salaryText: string | null;
  locationRaw: string | null;
  workMode: WorkMode;
  excludedReason: string | null;
  /** confirmed | unknown — "unknown" = the posting never says which intake it is for */
  intakeStatus: string | null;
  firstSeen: string;
  companyId: number;
  company: string;
  companySlug: string;
  logoUrl: string | null;
  domain: string | null;
  sector: string | null;
  aiForward: number | null;
  status: string | null;
  sources: string[];
  /** 1-based position among every kept role by rank score; null for a filtered-out or closed role */
  rankPos: number | null;
  /** anything to do with sport: the company's sector, Claude's role family, or SPORT_COMPANIES */
  sport: boolean;
  /** the location names London (or an outer borough); false = elsewhere, UK-wide, remote or not stated */
  inLondon: boolean;
}

/** The set of roles the list ranks against: active, kept, and not closed or binned ("Not interested") by Jonno. */
const KEPT = (j: string, a: string) =>
  `${j}.is_active = 1 and ${j}.excluded_reason is null and (${a}.status is null or ${a}.status not in ('closed', 'dismissed'))`;
const SPORT_NAMES = SPORT_COMPANIES.map((n) => `'${n.toLowerCase().replace(/'/g, "''")}'`).join(",") || "''";

const LIST_COLS = `
  j.id, j.title, j.kind, j.rank_score, j.deadline, j.deadline_text, j.salary_text,
  j.location_raw, j.work_mode, j.excluded_reason, j.intake_status, j.first_seen,
  c.id as company_id, c.name as company, c.slug as company_slug, c.logo_url, c.domain,
  c.sector, c.ai_forward, a.status,
  (select group_concat(s.source) from (select distinct source from job_sources where job_id = j.id) s) as sources,
  case when ${KEPT("j", "a")} then (
    select count(*) + 1 from jobs j2 left join applications a2 on a2.job_id = j2.id
    where ${KEPT("j2", "a2")} and (j2.rank_score > j.rank_score or (j2.rank_score = j.rank_score and j2.id < j.id))
  ) end as rank_pos,
  (c.sector = 'sport' or lower(c.name) in (${SPORT_NAMES})
    or exists (select 1 from role_evaluations e where e.job_id = j.id and e.family = 'sport')) as is_sport,
  is_london(j.location_raw) as in_london`;

const toListRow = (r: Record<string, unknown>): JobListRow => ({
  id: Number(r.id),
  title: String(r.title),
  kind: r.kind as JobKind,
  rankScore: Number(r.rank_score),
  deadline: (r.deadline as string) ?? null,
  deadlineText: (r.deadline_text as string) ?? null,
  salaryText: (r.salary_text as string) ?? null,
  locationRaw: (r.location_raw as string) ?? null,
  workMode: r.work_mode as WorkMode,
  excludedReason: (r.excluded_reason as string) ?? null,
  intakeStatus: (r.intake_status as string) ?? null,
  firstSeen: String(r.first_seen),
  companyId: Number(r.company_id),
  company: String(r.company),
  companySlug: String(r.company_slug),
  logoUrl: (r.logo_url as string) ?? null,
  domain: (r.domain as string) ?? null,
  sector: (r.sector as string) ?? null,
  aiForward: r.ai_forward == null ? null : Number(r.ai_forward),
  status: (r.status as string) ?? null,
  sources: String(r.sources ?? "").split(",").filter(Boolean),
  rankPos: r.rank_pos == null ? null : Number(r.rank_pos),
  sport: Boolean(r.is_sport),
  inLondon: Boolean(r.in_london),
});

export type SortKey = "deadline" | "rank" | "newest";

export interface ListFilters {
  sort: SortKey;
  kinds: string[];
  sectors: string[];
  statuses: string[];
  window: string | null;
  showExcluded: boolean;
  /** only roles whose 2027 intake is confirmed by the title, start date, description or employer page */
  confirmedOnly: boolean;
  /** only roles whose location names London (hides UK-wide, remote, blank and elsewhere) */
  londonOnly: boolean;
  q: string | null;
  limit: number;
}

export const DEFAULT_FILTERS: ListFilters = {
  sort: "deadline", kinds: [], sectors: [], statuses: [], window: null,
  showExcluded: false, confirmedOnly: false, londonOnly: false, q: null, limit: 300,
};

/** Builds the WHERE clause shared by the list and its facet counts. */
function whereFor(f: ListFilters): { sql: string; params: unknown[] } {
  const where: string[] = ["j.is_active = 1"];
  const params: unknown[] = [];

  where.push(f.showExcluded ? "1=1" : "j.excluded_reason is null");

  if (f.kinds.length) {
    where.push(`j.kind in (${f.kinds.map(() => "?").join(",")})`);
    params.push(...f.kinds);
  }
  if (f.sectors.length) {
    const hasNone = f.sectors.includes("__none__");
    const named = f.sectors.filter((s) => s !== "__none__");
    const parts: string[] = [];
    if (named.length) { parts.push(`c.sector in (${named.map(() => "?").join(",")})`); params.push(...named); }
    if (hasNone) parts.push("c.sector is null");
    if (parts.length) where.push(`(${parts.join(" or ")})`);
  }
  // A role Jonno marked closed (the employer ended the process) or binned ("Not interested") is void: it lives in the
  // Applications archive and only shows here when the status filter asks for it.
  const hide = ["closed", "dismissed"].filter((s) => !f.statuses.includes(s));
  if (hide.length) where.push(`(a.status is null or a.status not in (${hide.map((s) => `'${s}'`).join(", ")}))`);
  if (f.statuses.length) {
    const hasNew = f.statuses.includes("__none__");
    const named = f.statuses.filter((s) => s !== "__none__");
    const parts: string[] = [];
    if (named.length) { parts.push(`a.status in (${named.map(() => "?").join(",")})`); params.push(...named); }
    if (hasNew) parts.push("a.status is null");
    if (parts.length) where.push(`(${parts.join(" or ")})`);
  }
  if (f.window === "week") where.push("j.deadline is not null and julianday(j.deadline) - julianday('now') between -0.999 and 7");
  if (f.window === "month") where.push("j.deadline is not null and julianday(j.deadline) - julianday('now') between -0.999 and 30");
  if (f.window === "none") where.push("j.deadline is null");
  if (f.confirmedOnly) where.push("j.intake_status = 'confirmed'");
  if (f.londonOnly) where.push("is_london(j.location_raw) = 1");
  if (f.q) {
    where.push("(j.title like ? or c.name like ?)");
    params.push(`%${f.q}%`, `%${f.q}%`);
  }
  return { sql: where.join(" and "), params };
}

const ORDER: Record<SortKey, string> = {
  deadline: "(j.deadline is null), j.deadline asc, j.rank_score desc, j.id",
  rank: "j.rank_score desc, (j.deadline is null), j.deadline asc, j.id",
  newest: "j.first_seen desc, j.id desc",
};

export function listJobs(f: ListFilters): JobListRow[] {
  const { sql, params } = whereFor(f);
  return (getSqlite().prepare(`
    select ${LIST_COLS}
    from jobs j
    join companies c on c.id = j.company_id
    left join applications a on a.job_id = j.id
    where ${sql}
    order by ${ORDER[f.sort]}
    limit ?`).all(...params, f.limit) as Record<string, unknown>[]).map(toListRow);
}

/** Counts shown on the filter chips, computed against the *other* active filters. */
export function listFacets(f: ListFilters) {
  const db = getSqlite();
  const base = (o: Partial<ListFilters>) => {
    const { sql, params } = whereFor({ ...f, ...o });
    return { sql, params };
  };
  const count = (o: Partial<ListFilters>, extra = "") => {
    const { sql, params } = base(o);
    return Number((db.prepare(`
      select count(*) as n from jobs j
      join companies c on c.id = j.company_id
      left join applications a on a.job_id = j.id
      where ${sql}${extra ? ` and ${extra}` : ""}`).get(...params) as { n: number }).n);
  };

  const { sql, params } = base({ kinds: [], sectors: [], window: null, statuses: [] });
  const kinds = db.prepare(`
    select j.kind as k, count(*) as n from jobs j
    join companies c on c.id = j.company_id
    left join applications a on a.job_id = j.id
    where ${sql} group by 1 order by n desc`).all(...params) as { k: string; n: number }[];
  const sectors = db.prepare(`
    select coalesce(c.sector,'__none__') as k, count(*) as n from jobs j
    join companies c on c.id = j.company_id
    left join applications a on a.job_id = j.id
    where ${sql} group by 1 order by n desc`).all(...params) as { k: string; n: number }[];
  const statuses = db.prepare(`
    select coalesce(a.status,'__none__') as k, count(*) as n from jobs j
    join companies c on c.id = j.company_id
    left join applications a on a.job_id = j.id
    where ${sql} group by 1 order by n desc`).all(...params) as { k: string; n: number }[];

  return {
    kinds, sectors, statuses,
    total: count({ kinds: [], sectors: [], window: null, statuses: [] }),
    windows: {
      week: count({ window: "week", kinds: [], sectors: [], statuses: [] }),
      month: count({ window: "month", kinds: [], sectors: [], statuses: [] }),
      none: count({ window: "none", kinds: [], sectors: [], statuses: [] }),
    },
    intakeConfirmed: count({ confirmedOnly: true }),
    london: count({ londonOnly: true }),
    excluded: Number((db.prepare(
      "select count(*) as n from jobs where is_active=1 and excluded_reason is not null",
    ).get() as { n: number }).n),
  };
}

export interface Suggestion extends JobListRow {
  /** Claude's one-line read of the role (role_evaluations.one_line) */
  oneLine: string | null;
  /** whole days to the deadline; null = none published */
  days: number | null;
  priority: number;
  /** first seen in the last two weeks: the tile wears a New tag */
  fresh: boolean;
}

/** Points added to the rank score for a deadline, so a strong role closing soon beats a marginally better one with months left. */
export function urgencyBonus(days: number | null): number {
  if (days === null) return 0;
  return days <= 7 ? 12 : days <= 14 ? 8 : days <= 30 ? 4 : 0;
}

/** Newly listed roles get in first: a small bonus for a week, less for a fortnight. `age` = whole days since first seen. */
export function freshBonus(age: number): number {
  return age <= 7 ? 6 : age <= 14 ? 3 : 0;
}

/** Below this rank score a role is not worth an "apply now" slot (Jonno's rubric: 50 is mid-table). */
export const APPLY_MIN_SCORE = 50;
/** Roles he marked Interested himself get a nudge over equally ranked ones. */
const INTERESTED_BONUS = 5;

/**
 * "What should I apply for now" (Up next, the Apply now section and the week plan): roles Claude has evaluated with a
 * rank score of at least APPLY_MIN_SCORE, no dealbreaker, not yet being applied for, that have something to apply to
 * (not register-interest) and haven't closed. Ordered by rank score plus bonuses for a close deadline, being new in the
 * last two weeks, and having been marked Interested. One role per company, the best one. `skip` = ids waved past.
 */
export function suggestNext(skip: number[] = [], n = 3): Suggestion[] {
  const rows = (getSqlite().prepare(`
    select ${LIST_COLS}, e.one_line
    from jobs j
    join companies c on c.id = j.company_id
    left join applications a on a.job_id = j.id
    left join role_evaluations e on e.job_id = j.id
    where ${KEPT("j", "a")}
      and (a.status is null or a.status in ('discovered', 'interested'))
      and j.rank_score >= ${APPLY_MIN_SCORE}
      and json_extract(j.rank_breakdown, '$.dealbreaker') is null
      and j.kind <> 'register_interest'
      and (j.deadline is null or julianday(j.deadline) - julianday(date('now')) >= 0)
    order by j.rank_score desc, j.id
    limit 200`).all() as Record<string, unknown>[]);
  const today = Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const ranked = rows
    .map((r): Suggestion => {
      const row = toListRow(r);
      const days = row.deadline ? Math.round((Date.parse(row.deadline) - today) / 86_400_000) : null;
      const age = Math.max(0, Math.round((today - Date.parse(row.firstSeen.slice(0, 10))) / 86_400_000));
      const fresh = freshBonus(Number.isNaN(age) ? 99 : age);
      const interested = row.status === "interested";
      return {
        ...row, oneLine: (r.one_line as string) ?? null, days, fresh: fresh > 0,
        priority: row.rankScore + urgencyBonus(days) + fresh + (interested ? INTERESTED_BONUS : 0),
      };
    })
    .filter((s) => !skip.includes(s.id))
    .sort((x, y) => y.priority - x.priority || x.id - y.id);
  const seen = new Set<number>();
  return ranked.filter((s) => (seen.has(s.companyId) ? false : (seen.add(s.companyId), true))).slice(0, n);
}

export interface FactRow {
  field: string; valueText: string; sourceUrl: string;
  sourceKind: string; confidence: string; fetchedAt: string; valueJson: unknown;
}

export function factsFor(entityType: "job" | "company", entityId: number): FactRow[] {
  return (getSqlite().prepare(`
    select field, value_text, value_json, source_url, source_kind, confidence, fetched_at
    from facts where entity_type = ? and entity_id = ? order by field, confidence`)
    .all(entityType, entityId) as Record<string, unknown>[]).map((r) => ({
      field: String(r.field), valueText: String(r.value_text), sourceUrl: String(r.source_url),
      sourceKind: String(r.source_kind), confidence: String(r.confidence), fetchedAt: String(r.fetched_at),
      valueJson: parse<unknown>(r.value_json, null),
    }));
}

/** The `liveness` fact written by `npm run liveness`, or null if the shape is not recognisable. */
export function liveness(valueJson: unknown): { status: "open" | "closed" | "unknown"; evidence: string; checkedAt: string } | null {
  const v = (valueJson as { value?: { status?: string; evidence?: string; checkedAt?: string } } | null)?.value;
  if (!v || !["open", "closed", "unknown"].includes(String(v.status))) return null;
  return { status: v.status as "open" | "closed" | "unknown", evidence: String(v.evidence ?? ""), checkedAt: String(v.checkedAt ?? "") };
}

export interface JobDetail extends JobListRow {
  functionName: string | null;
  descriptionText: string | null;
  startText: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  applyUrl: string | null;
  canonicalUrl: string | null;
  eligibility: Eligibility | null;
  applicationRequirements: ApplicationRequirements | null;
  processStages: string[];
  rankBreakdown: Record<string, number>;
  extractionMeta: ExtractionMeta | null;
  companySummary: string | null;
  aiForwardRationale: string | null;
  researchUpdatedAt: string | null;
  sourceLinks: { source: string; url: string; lastSeen: string }[];
  nextAction: string | null;
  nextActionDue: string | null;
  notes: string | null;
  appliedAt: string | null;
  applicationId: number | null;
}

export function getJob(id: number): JobDetail | null {
  const db = getSqlite();
  const r = db.prepare(`
    select ${LIST_COLS}, j.function as fn, j.description_text, j.start_text, j.salary_min, j.salary_max,
           j.apply_url, j.canonical_url, j.eligibility, j.application_requirements, j.process_stages,
           j.rank_breakdown, j.extraction_meta,
           c.summary as company_summary, c.ai_forward_rationale, c.research_updated_at,
           a.id as application_id, a.next_action, a.next_action_due, a.notes, a.applied_at
    from jobs j
    join companies c on c.id = j.company_id
    left join applications a on a.job_id = j.id
    where j.id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!r) return null;

  const links = db.prepare(
    "select source, url, last_seen from job_sources where job_id = ? order by source",
  ).all(id) as { source: string; url: string; last_seen: string }[];

  return {
    ...toListRow(r),
    functionName: (r.fn as string) ?? null,
    descriptionText: (r.description_text as string) ?? null,
    startText: (r.start_text as string) ?? null,
    salaryMin: r.salary_min == null ? null : Number(r.salary_min),
    salaryMax: r.salary_max == null ? null : Number(r.salary_max),
    applyUrl: (r.apply_url as string) ?? null,
    canonicalUrl: (r.canonical_url as string) ?? null,
    eligibility: parse<Eligibility | null>(r.eligibility, null),
    applicationRequirements: parse<ApplicationRequirements | null>(r.application_requirements, null),
    processStages: parse<string[]>(r.process_stages, []),
    rankBreakdown: parse<Record<string, number>>(r.rank_breakdown, {}),
    extractionMeta: parse<ExtractionMeta | null>(r.extraction_meta, null),
    companySummary: (r.company_summary as string) ?? null,
    aiForwardRationale: (r.ai_forward_rationale as string) ?? null,
    researchUpdatedAt: (r.research_updated_at as string) ?? null,
    sourceLinks: links.map((l) => ({ source: l.source, url: l.url, lastSeen: l.last_seen })),
    applicationId: r.application_id == null ? null : Number(r.application_id),
    nextAction: (r.next_action as string) ?? null,
    nextActionDue: (r.next_action_due as string) ?? null,
    notes: (r.notes as string) ?? null,
    appliedAt: (r.applied_at as string) ?? null,
  };
}

/** Claude's evaluation of one role (role_evaluations), or null if not evaluated yet. */
export function getEvaluation(jobId: number): RoleEvaluation | null {
  return getDb().select().from(schema.roleEvaluations).where(eq(schema.roleEvaluations.jobId, jobId)).get() ?? null;
}

export interface GlanceFact { value: string; sourceUrl: string; sourceKind: string; confidence: string }

/**
 * The automated company research (`npm run research`) as one deduplicated value list per field, for the company
 * tiles: the same "4.4/5 from 1946 reviews" row was stored six times for PwC. Leaves out deep-research (`dr.*`) rows
 * and the `search_snippets` bookkeeping rows ("8 results for …"), which say nothing about the company.
 */
export function companyGlance(companyId: number): Record<string, GlanceFact[]> {
  const out: Record<string, GlanceFact[]> = {};
  const seen = new Set<string>();
  for (const f of factsFor("company", companyId)) {
    if (f.field.startsWith("dr.") || f.field === "search_snippets") continue;
    const k = `${f.field}\u0000${f.valueText.trim().toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    (out[f.field] ??= []).push({ value: f.valueText.trim(), sourceUrl: f.sourceUrl, sourceKind: f.sourceKind, confidence: f.confidence });
  }
  return out;
}

/** One sourced deep-research claim (a `dr.<section>.<key>` fact; see lib/apply/research.ts). */
export interface ResearchClaim {
  section: string; key: string; about: "job" | "company"; text: string; quote: string | null; value: string | null;
  publishedAt: string | null; sourceUrl: string; sourceKind: string; confidence: string; fetchedAt: string;
  /** values claims only: Claude's pick of one of Jonno's story titles */
  story?: string | null;
}
export interface CommuteRow { from: string; minutes: number; summary: string; office: string; departs: string; sourceUrl: string }

/**
 * Deep research for a role: the judgement row (null = not researched), its sourced claims (the role's own plus the
 * employer's, in the order the research listed them), and the TfL journey times to its office.
 */
export function researchFor(jobId: number, companyId: number): { row: RoleResearch | null; claims: ResearchClaim[]; commutes: CommuteRow[] } {
  const row = getDb().select().from(schema.roleResearch).where(eq(schema.roleResearch.jobId, jobId)).get() ?? null;
  const facts = getSqlite().prepare(`
    select entity_type, field, value_text, value_json, source_url, source_kind, confidence, fetched_at from facts
    where field like 'dr.%' and ((entity_type = 'job' and entity_id = ?) or (entity_type = 'company' and entity_id = ?))
    order by id`).all(jobId, companyId) as Record<string, unknown>[];
  const claims: ResearchClaim[] = [];
  const commutes: CommuteRow[] = [];
  for (const f of facts) {
    const v = parse<Record<string, unknown>>(f.value_json, {});
    if (String(f.field).startsWith("dr.commute.")) {
      commutes.push({ from: String(v.from), minutes: Number(v.minutes), summary: String(v.summary ?? ""), office: String(v.office ?? ""),
        departs: String(v.departs ?? ""), sourceUrl: String(f.source_url) });
      continue;
    }
    const [, section = "", key = ""] = String(f.field).split(".");
    claims.push({
      section, key, about: f.entity_type === "company" ? "company" : "job", text: String(f.value_text),
      quote: (v.quote as string) ?? null, value: (v.value as string) ?? null, publishedAt: (v.publishedAt as string) ?? null, story: (v.story as string) ?? null,
      sourceUrl: String(f.source_url), sourceKind: String(f.source_kind), confidence: String(f.confidence), fetchedAt: String(f.fetched_at),
    });
  }
  return { row, claims, commutes };
}

export interface CompanyDetail {
  id: number; slug: string; name: string; domain: string | null; website: string | null;
  logoUrl: string | null; sector: string | null; subSector: string | null; summary: string | null;
  sizeBand: string | null; headcount: number | null; hq: string | null; londonOffice: boolean | null;
  hybridPolicy: string | null; aiForward: number | null; aiForwardRationale: string | null;
  researchUpdatedAt: string | null;
}

export function getCompanyBySlug(slug: string): CompanyDetail | null {
  const r = getSqlite().prepare("select * from companies where slug = ?").get(slug) as
    Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: Number(r.id), slug: String(r.slug), name: String(r.name),
    domain: (r.domain as string) ?? null, website: (r.website as string) ?? null,
    logoUrl: (r.logo_url as string) ?? null, sector: (r.sector as string) ?? null,
    subSector: (r.sub_sector as string) ?? null, summary: (r.summary as string) ?? null,
    sizeBand: (r.size_band as string) ?? null,
    headcount: r.headcount == null ? null : Number(r.headcount),
    hq: (r.hq as string) ?? null,
    londonOffice: r.london_office == null ? null : Boolean(r.london_office),
    hybridPolicy: (r.hybrid_policy as string) ?? null,
    aiForward: r.ai_forward == null ? null : Number(r.ai_forward),
    aiForwardRationale: (r.ai_forward_rationale as string) ?? null,
    researchUpdatedAt: (r.research_updated_at as string) ?? null,
  };
}

export function jobsForCompany(companyId: number): JobListRow[] {
  return (getSqlite().prepare(`
    select ${LIST_COLS} from jobs j
    join companies c on c.id = j.company_id
    left join applications a on a.job_id = j.id
    where j.company_id = ? and j.is_active = 1
    order by (j.excluded_reason is not null), (j.deadline is null), j.deadline, j.rank_score desc`)
    .all(companyId) as Record<string, unknown>[]).map(toListRow);
}

export function newsForCompany(companyId: number, limit = 10) {
  return getSqlite().prepare(`
    select title, url, published_at, source_name from news_items
    where company_id = ? order by (published_at is null), published_at desc limit ?`)
    .all(companyId, limit) as
    { title: string; url: string; published_at: string | null; source_name: string | null }[];
}

export interface SweepSourceRow {
  id: number; runId: number; source: string; status: string;
  discovered: number; inserted: number; updated: number;
  error: string | null; durationMs: number; startedAt: string; finishedAt: string | null;
}

export function recentSweeps(limit = 40): SweepSourceRow[] {
  return (getSqlite().prepare(`
    select s.id, s.run_id, s.source, s.status, s.discovered, s.inserted, s.updated,
           s.error, s.duration_ms, r.started_at, r.finished_at
    from sweep_run_sources s join sweep_runs r on r.id = s.run_id
    order by s.id desc limit ?`).all(limit) as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id), runId: Number(r.run_id), source: String(r.source), status: String(r.status),
      discovered: Number(r.discovered), inserted: Number(r.inserted), updated: Number(r.updated),
      error: (r.error as string) ?? null, durationMs: Number(r.duration_ms),
      startedAt: String(r.started_at), finishedAt: (r.finished_at as string) ?? null,
    }));
}

/**
 * Sources that failed on their most recent run. Drives the banner: a source that failed once but
 * has since succeeded is not an open problem, so only the latest outcome per source counts.
 */
export function failingSources(): SweepSourceRow[] {
  return (getSqlite().prepare(`
    select s.id, s.run_id, s.source, s.status, s.discovered, s.inserted, s.updated,
           s.error, s.duration_ms, r.started_at, r.finished_at
    from sweep_run_sources s join sweep_runs r on r.id = s.run_id
    where s.id in (select max(id) from sweep_run_sources group by source)
      and s.status = 'failed'
    order by s.source`).all() as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id), runId: Number(r.run_id), source: String(r.source), status: String(r.status),
      discovered: Number(r.discovered), inserted: Number(r.inserted), updated: Number(r.updated),
      error: (r.error as string) ?? null, durationMs: Number(r.duration_ms),
      startedAt: String(r.started_at), finishedAt: (r.finished_at as string) ?? null,
    }));
}

export interface ApplicationRow {
  id: number;
  jobId: number;
  status: string;
  nextAction: string | null;
  nextActionDue: string | null;
  notes: string | null;
  appliedAt: string | null;
  dismissedReason: string | null;
  updatedAt: string;
  lastActivityAt: string | null;
  title: string;
  deadline: string | null;
  jobActive: boolean;
  excludedReason: string | null;
  company: string;
  companySlug: string;
  logoUrl: string | null;
  domain: string | null;
  /** the liveness fact, when the check has run */
  live: { status: "open" | "closed" | "unknown"; evidence: string; checkedAt: string } | null;
}

/**
 * Every tracked application, whatever became of the role: the Roles list hides excluded and
 * inactive jobs, so a role that closed or got filtered after you tracked it only shows here.
 */
export function listApplications(): ApplicationRow[] {
  return (getSqlite().prepare(`
    select a.id, a.job_id, a.status, a.next_action, a.next_action_due, a.notes, a.applied_at,
           a.dismissed_reason, a.updated_at,
           (select max(at) from activity_log l where l.application_id = a.id) as last_activity_at,
           j.title, j.deadline, j.is_active, j.excluded_reason,
           c.name as company, c.slug as company_slug, c.logo_url, c.domain,
           (select f.value_json from facts f where f.entity_type = 'job' and f.entity_id = j.id
              and f.field = 'liveness' order by f.id desc limit 1) as liveness_json
    from applications a
    join jobs j on j.id = a.job_id
    join companies c on c.id = j.company_id
    order by (a.next_action_due is null), a.next_action_due, (j.deadline is null), j.deadline, a.updated_at desc`)
    .all() as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id), jobId: Number(r.job_id), status: String(r.status),
      nextAction: (r.next_action as string) ?? null, nextActionDue: (r.next_action_due as string) ?? null,
      notes: (r.notes as string) ?? null, appliedAt: (r.applied_at as string) ?? null,
      dismissedReason: (r.dismissed_reason as string) ?? null, updatedAt: String(r.updated_at),
      lastActivityAt: (r.last_activity_at as string) ?? null,
      title: String(r.title), deadline: (r.deadline as string) ?? null,
      jobActive: Number(r.is_active) === 1, excludedReason: (r.excluded_reason as string) ?? null,
      company: String(r.company), companySlug: String(r.company_slug),
      logoUrl: (r.logo_url as string) ?? null, domain: (r.domain as string) ?? null,
      live: liveness(parse(r.liveness_json, null)),
    }));
}

/**
 * Where each rejected or closed application stood when it ended: the status it moved FROM into its final one (the last
 * such move in the activity log). `null` = no move recorded, or it went straight from `discovered`.
 */
export function endedFrom(): Record<number, string | null> {
  const rows = getSqlite().prepare(`
    select a.id, l.from_status
    from applications a
    left join activity_log l on l.id = (
      select max(id) from activity_log where application_id = a.id and to_status = a.status)
    where a.status in ('rejected', 'closed')`).all() as { id: number; from_status: string | null }[];
  return Object.fromEntries(rows.map((r) => [Number(r.id), r.from_status]));
}

export interface EmailUpdateRow {
  id: number; applicationId: number | null; receivedAt: string; sender: string; subject: string; kind: string;
  summary: string | null; viewUrl: string | null; companyHint: string | null; statusApplied: string | null;
  actionText: string | null; actionDue: string | null; actionDone: boolean;
  /** the tracked role this email is about, when it matched one */
  company: string | null; title: string | null; jobId: number | null;
}

/** Recruiter emails recorded by the Gmail sync, newest first. */
export function listEmailUpdates(): EmailUpdateRow[] {
  return (getSqlite().prepare(`
    select e.*, c.name as company, j.title, j.id as job_id_resolved
    from email_updates e
    left join applications a on a.id = e.application_id
    left join jobs j on j.id = a.job_id
    left join companies c on c.id = j.company_id
    order by e.received_at desc, e.id desc`).all() as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id), applicationId: r.application_id == null ? null : Number(r.application_id),
      receivedAt: String(r.received_at), sender: String(r.sender), subject: String(r.subject), kind: String(r.kind),
      summary: (r.summary as string) ?? null, viewUrl: (r.view_url as string) ?? null,
      companyHint: (r.company_hint as string) ?? null, statusApplied: (r.status_applied as string) ?? null,
      actionText: (r.action_text as string) ?? null, actionDue: (r.action_due as string) ?? null,
      actionDone: Number(r.action_done) === 1,
      company: (r.company as string) ?? null, title: (r.title as string) ?? null,
      jobId: r.job_id_resolved == null ? null : Number(r.job_id_resolved),
    }));
}

export function activityFor(applicationId: number) {
  return getSqlite().prepare(`
    select from_status, to_status, note, at from activity_log
    where application_id = ? order by at desc, id desc`).all(applicationId) as
    { from_status: string | null; to_status: string; note: string | null; at: string }[];
}

/** The weekly goal for the "This week" rings: see lib/tracker/goals.ts for the rules. */
export function currentWeekGoal(now = new Date()): WeekGoal {
  const db = getSqlite();
  const apps = (db.prepare("select id, status, applied_at from applications").all() as Record<string, unknown>[])
    .map((r) => ({ id: Number(r.id), status: String(r.status), appliedAt: (r.applied_at as string) ?? null }));
  const moves = (db.prepare("select application_id, from_status, to_status, at from activity_log").all() as Record<string, unknown>[])
    .map((r) => ({ appId: Number(r.application_id), from: (r.from_status as string) ?? null, to: String(r.to_status), at: String(r.at) }));
  return weekGoal(apps, moves, now);
}

export interface DoItem {
  jobId: number; company: string; title: string; logoUrl: string | null; domain: string | null;
  status: string; rankScore: number;
  /** Jonno's own next step, or the stage default (lib/tracker/steps.ts) when he hasn't set one */
  step: string; auto: boolean;
  /** when it matters, in whole days: his step's due date, else the application deadline before submitting */
  days: number | null;
}
export interface DoNext {
  items: DoItem[];
  /** where every tracked role stands, with the Applications page's meanings */
  pipeline: { interested: number; applying: number; waiting: number; tests: number; hirevues: number; interviews: number; offers: number };
}

/**
 * The Roles page's "Do next" list (2026-09-29): every live application with what to do next and when, soonest first.
 * Roles sent and waiting (applied, tests done) only show once there is something to do: his own step, or the chase
 * date coming due. `skipId` = the Up next pick, which heads the list on its own row.
 */
export function doNext(skipId: number | null = null): DoNext {
  const db = getSqlite();
  const today = Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const daysTo = (d: string | null) => (d ? Math.round((Date.parse(d.slice(0, 10)) - today) / 86_400_000) : null);
  const rows = db.prepare(`
    select j.id, j.title, j.deadline, j.rank_score, c.name as company, c.logo_url, c.domain,
           a.status, a.next_action, a.next_action_due, a.applied_at,
           -- the recruiter's open ask, from the Gmail sync (e.g. "Complete the Pymetrics games by 3 Oct")
           (select e.action_text from email_updates e where e.application_id = a.id and e.action_done = 0 and e.action_text is not null
              order by (e.action_due is null), e.action_due limit 1) as email_step,
           (select min(e.action_due) from email_updates e where e.application_id = a.id and e.action_done = 0) as email_due
    from applications a join jobs j on j.id = a.job_id join companies c on c.id = j.company_id
    where a.status in ('interested', 'applying', 'applied', 'tests', 'tests_done', 'hirevue', 'hirevue_done', 'interview', 'interview_done', 'offer')`)
    .all() as Record<string, unknown>[];
  const PRE = new Set(["interested", "applying"]);
  const items = rows.flatMap((r): DoItem[] => {
    const status = String(r.status);
    // his own step first, then what the recruiter asked for, then the stage default
    const own = (r.next_action as string) ?? (r.email_step as string) ?? null;
    const def = defaultStep(status, (r.applied_at as string) ?? null);
    const step = own ?? def?.text;
    if (!step || Number(r.id) === skipId) return [];
    const due = ((r.next_action as string) ? (r.next_action_due as string) : null) ?? (r.email_due as string) ?? (own ? null : def?.due) ?? null;
    const days = daysTo(due) ?? (PRE.has(status) ? daysTo((r.deadline as string) ?? null) : null);
    // sent and waiting: nothing to do until the chase date is within a week (or he set a step himself)
    if (!own && ["applied", "tests_done", "hirevue_done", "interview_done"].includes(status) && (days === null || days > 7)) return [];
    return [{
      jobId: Number(r.id), company: String(r.company), title: String(r.title), logoUrl: (r.logo_url as string) ?? null,
      domain: (r.domain as string) ?? null, status, rankScore: Number(r.rank_score), step, auto: !own, days,
    }];
  });
  // soonest first; undated ones after, furthest along the pipeline first (finish before starting more)
  const STAGE = ["offer", "interview", "hirevue", "tests", "applying", "applied", "tests_done", "hirevue_done", "interview_done", "interested"];
  items.sort((x, y) => (x.days ?? 1e6) - (y.days ?? 1e6) || STAGE.indexOf(x.status) - STAGE.indexOf(y.status)
    || y.rankScore - x.rankScore);
  const n = (...st: string[]) => rows.filter((r) => st.includes(String(r.status))).length;
  return {
    items,
    pipeline: {
      interested: n("interested"), applying: n("applying"), waiting: n("applied", "tests_done", "hirevue_done", "interview_done"),
      tests: n("tests"), hirevues: n("hirevue"), interviews: n("interview"), offers: n("offer"),
    },
  };
}

export interface CloseRole { jobId: number; company: string; logoUrl: string | null; domain: string | null; days: number; n: number }

/**
 * Last chance (hero, right side): roles worth applying for (evaluated, no dealbreaker, not started) that close within
 * two days, one row per company with how many of its roles close. `skipId` = the Up next pick.
 */
export function lastChance(skipId: number | null = null): CloseRole[] {
  const today = Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  return (getSqlite().prepare(`
    select j.id, j.deadline, c.name as company, c.logo_url, c.domain, count(*) over (partition by c.id) as n,
           row_number() over (partition by c.id order by j.deadline, j.rank_score desc) as k
    from jobs j join companies c on c.id = j.company_id left join applications a on a.job_id = j.id
    where ${KEPT("j", "a")} and (a.status is null or a.status in ('discovered', 'interested'))
      and j.rank_score >= 0 and json_extract(j.rank_breakdown, '$.dealbreaker') is null
      and j.kind <> 'register_interest' and j.id <> ?
      and julianday(j.deadline) - julianday(date('now')) between 0 and 2
    order by j.deadline, j.rank_score desc`).all(skipId ?? -1) as Record<string, unknown>[])
    .filter((r) => Number(r.k) === 1)
    .map((r) => ({
      jobId: Number(r.id), company: String(r.company), logoUrl: (r.logo_url as string) ?? null, domain: (r.domain as string) ?? null,
      days: Math.round((Date.parse(String(r.deadline)) - today) / 86_400_000), n: Number(r.n),
    }));
}

export interface PlanItem { jobId: number; company: string; title: string; logoUrl: string | null; domain: string | null; why: "finish" | "start"; days: number | null }

/**
 * This week's plan: what fills the Send ring. Roles already in Applying come first (finish what's started), then the
 * best unstarted picks from `suggestNext()`, up to what's left of the target (at least one, at most five).
 */
export function weekPlan(left: number): PlanItem[] {
  const n = Math.min(5, Math.max(1, left));
  const today = Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const daysTo = (d: string | null) => (d ? Math.round((Date.parse(d) - today) / 86_400_000) : null);
  const finishing = (getSqlite().prepare(`
    select j.id, j.title, j.deadline, c.name as company, c.logo_url, c.domain
    from applications a join jobs j on j.id = a.job_id join companies c on c.id = j.company_id
    where a.status = 'applying' and (j.is_active = 1 or j.dedupe_key like 'manual|%')
    order by (j.deadline is null), j.deadline`).all() as Record<string, unknown>[]).map((r): PlanItem => ({
      jobId: Number(r.id), company: String(r.company), title: String(r.title), logoUrl: (r.logo_url as string) ?? null,
      domain: (r.domain as string) ?? null, why: "finish", days: daysTo((r.deadline as string) ?? null),
    }));
  const starting = suggestNext([], n).map((s): PlanItem => ({
    jobId: s.id, company: s.company, title: s.title, logoUrl: s.logoUrl, domain: s.domain, why: "start", days: s.days,
  }));
  return [...finishing, ...starting].slice(0, n);
}
