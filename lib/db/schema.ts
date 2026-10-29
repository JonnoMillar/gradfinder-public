/**
 * Data model — three layers with a one-way dependency:
 *   Layer 1 (raw/provenance): snapshots, job_sources   — what sources said
 *   Layer 2 (derived):        companies, jobs, facts, news_items — what we derived; rebuilt by sweeps
 *   Layer 3 (user):           applications, activity_log, email_updates — what Jonno did; never written by the
 *                             pipeline (the Gmail sync writes here on his behalf, via lib/tracker/email.ts only)
 *   Ops:                      sweep_runs, sweep_run_sources — per-source outcomes so failures are visible
 */
import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

// ---------- enums (kept as string unions; SQLite has no enum type) ----------
export const SOURCES = [
  "higherin", "targetjobs", "brightnetwork", "linkedin", "indeed",
  "greenhouse", "lever", "ashby", "gradcracker",
] as const;
export type Source = (typeof SOURCES)[number];

export const JOB_KINDS = [
  "graduate_scheme", "graduate_job", "register_interest", "internship", "placement", "insight", "other", "unknown",
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const WORK_MODES = ["onsite", "hybrid", "remote", "unknown"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const APPLICATION_STATUSES = [
  "discovered", "interested", "applying", "applied", "tests",
  /** sat the tests, waiting on the outcome (Jonno 2026-09-28) */
  "tests_done",
  /** a HireVue (recorded video interview) to do: your move, like tests (Jonno 2026-10-02) */
  "hirevue",
  /** recorded the HireVue, waiting on the outcome: the ticked HireVue step (Jonno 2026-10-09) */
  "hirevue_done",
  "interview",
  /** had the interview, waiting on the outcome: the ticked Interview step (Jonno 2026-10-09) */
  "interview_done", "offer", "rejected", "dismissed",
  /** the employer closed the process: the role can't be got, so it is archived (Jonno 2026-09-27) */
  "closed",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** What a recruiter email means for the tracker. Classified by the Claude run that reads Gmail. */
export const EMAIL_KINDS = [
  "received", "assessment_invite", "interview_invite", "offer", "rejection", "action_required", "other",
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export const FACT_SOURCE_KINDS = [
  "posting", "company_site", "wikipedia", "news", "reviews", "search_snippet", "ats", "journey_planner",
] as const;
export type FactSourceKind = (typeof FACT_SOURCE_KINDS)[number];

export const CONFIDENCE = ["high", "medium", "low"] as const;
export type Confidence = (typeof CONFIDENCE)[number];

// ---------- JSON column shapes ----------
export type TriState = true | false | "unknown";
export interface ApplicationRequirements {
  cv: TriState;
  cover_letter: TriState;
  motivational_questions: TriState;
  video_interview: TriState;
  online_tests: TriState;
  assessment_centre: TriState;
  other: string[];
}
export interface Eligibility {
  degree_class: string | null;      // e.g. "2:1", "2:2", "1st", null = not stated
  subjects: string[];               // [] = any
  visa_sponsorship: TriState;
  other: string[];
}
export interface ExtractionMeta {
  model: string;
  provider: string;
  prompt_hash: string;
  content_hash: string;
  at: string;
}

// ---------- Layer 1: raw / provenance ----------
export const snapshots = sqliteTable("snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  url: text("url").notNull(),
  source: text("source").notNull(),
  fetchedAt: text("fetched_at").notNull().default(now),
  httpStatus: integer("http_status").notNull(),
  contentHash: text("content_hash").notNull(),
  bodyPath: text("body_path").notNull(),
}, (t) => [index("snapshots_url_idx").on(t.url)]);

export const jobSources = sqliteTable("job_sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  source: text("source").$type<Source>().notNull(),
  sourceId: text("source_id").notNull(),
  url: text("url").notNull(),
  snapshotId: integer("snapshot_id").references(() => snapshots.id),
  firstSeen: text("first_seen").notNull().default(now),
  lastSeen: text("last_seen").notNull().default(now),      // bumped by fetch OR touch
  lastFetched: text("last_fetched"),                          // bumped only by a real fetch
}, (t) => [
  uniqueIndex("job_sources_source_sourceid_uq").on(t.source, t.sourceId),
  index("job_sources_job_idx").on(t.jobId),
]);

// ---------- Layer 2: derived ----------
export const companies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  aliases: text("aliases", { mode: "json" }).$type<string[]>().notNull().default([]),
  domain: text("domain"),
  website: text("website"),
  logoUrl: text("logo_url"),
  sector: text("sector"),
  subSector: text("sub_sector"),
  summary: text("summary"),
  sizeBand: text("size_band"),
  headcount: integer("headcount"),
  hq: text("hq"),
  londonOffice: integer("london_office", { mode: "boolean" }),
  hybridPolicy: text("hybrid_policy"),
  aiForward: integer("ai_forward"),                 // 0–3, null = not assessed
  aiForwardRationale: text("ai_forward_rationale"),
  researchUpdatedAt: text("research_updated_at"),
  createdAt: text("created_at").notNull().default(now),
});

export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  title: text("title").notNull(),
  kind: text("kind").$type<JobKind>().notNull().default("unknown"),
  function: text("function"),
  descriptionText: text("description_text"),
  descriptionHtml: text("description_html"),
  locationRaw: text("location_raw"),
  isLondon: integer("is_london", { mode: "boolean" }).notNull().default(false),
  workMode: text("work_mode").$type<WorkMode>().notNull().default("unknown"),
  salaryMin: integer("salary_min"),
  salaryMax: integer("salary_max"),
  salaryCurrency: text("salary_currency"),
  salaryText: text("salary_text"),
  startText: text("start_text"),
  deadline: text("deadline"),          // ISO date (YYYY-MM-DD) or null
  deadlineText: text("deadline_text"),
  applyUrl: text("apply_url"),
  canonicalUrl: text("canonical_url"),
  eligibility: text("eligibility", { mode: "json" }).$type<Eligibility>(),
  applicationRequirements: text("application_requirements", { mode: "json" }).$type<ApplicationRequirements>(),
  processStages: text("process_stages", { mode: "json" }).$type<string[]>(),
  excludedReason: text("excluded_reason"),
  /** confirmed | unknown (contradicted rows are excluded as wrong_intake). Written by refilter(). */
  intakeStatus: text("intake_status").$type<"confirmed" | "contradicted" | "unknown">(),
  /** ISO date the source says the posting went up (Greenhouse first_published, Lever createdAt, Ashby publishedAt, JSON-LD
   *  datePosted, jobspy date_posted). Null when the source gives none: "new" then falls back to first_seen. */
  postedAt: text("posted_at"),
  rankScore: real("rank_score").notNull().default(0),
  rankBreakdown: text("rank_breakdown", { mode: "json" }).$type<Record<string, number>>(),
  dedupeKey: text("dedupe_key").notNull().unique(),
  contentHash: text("content_hash"),
  extractionMeta: text("extraction_meta", { mode: "json" }).$type<ExtractionMeta>(),
  firstSeen: text("first_seen").notNull().default(now),
  lastSeen: text("last_seen").notNull().default(now),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
}, (t) => [
  index("jobs_company_idx").on(t.companyId),
  index("jobs_active_excluded_idx").on(t.isActive, t.excludedReason),
  index("jobs_deadline_idx").on(t.deadline),
]);

export const facts = sqliteTable("facts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type").$type<"company" | "job">().notNull(),
  entityId: integer("entity_id").notNull(),
  field: text("field").notNull(),
  valueText: text("value_text").notNull(),
  valueJson: text("value_json", { mode: "json" }).$type<unknown>(),
  sourceUrl: text("source_url").notNull(),
  sourceKind: text("source_kind").$type<FactSourceKind>().notNull(),
  confidence: text("confidence").$type<Confidence>().notNull(),
  fetchedAt: text("fetched_at").notNull().default(now),
}, (t) => [index("facts_entity_field_idx").on(t.entityType, t.entityId, t.field)]);

/**
 * Claude's read of one role against Jonno's preferences (lib/evaluate). Written by `npm run evaluate -- import`
 * from a Claude session's batch output — never by the free runtime chain. `grad_role = "no"` excludes the job
 * (via excludedReason); the 1–5 scores drive the rank (lib/pipeline/rank.ts). Scores other than pay are Claude's
 * judgement from the posting + general knowledge, NOT sourced facts; the UI labels them that way.
 */
export const roleEvaluations = sqliteTable("role_evaluations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().unique().references(() => jobs.id, { onDelete: "cascade" }),
  gradRole: text("grad_role").$type<"yes" | "no" | "unsure">().notNull(),
  gradRoleReason: text("grad_role_reason").notNull(),
  family: text("family").notNull(),
  oneLine: text("one_line").notNull(),
  dayToDay: text("day_to_day").notNull(),
  scores: text("scores", { mode: "json" }).$type<EvalScores>().notNull(),
  reasons: text("reasons", { mode: "json" }).$type<Record<keyof EvalScores, string>>().notNull(),
  stretch: text("stretch"),
  dealbreakers: text("dealbreakers", { mode: "json" }).$type<{ kind: string; evidence: string }[]>().notNull().default([]),
  salaryFromPosting: text("salary_from_posting"),
  confidence: text("confidence").$type<Confidence>().notNull(),
  /** jobs.content_hash when evaluated: a changed posting shows as "re-evaluate" */
  contentHash: text("content_hash"),
  model: text("model").notNull(),
  rubricVersion: integer("rubric_version").notNull(),
  evaluatedAt: text("evaluated_at").notNull().default(now),
});
export interface EvalScores {
  workFit: number; chance: number; companyType: number; careerPath: number; sector: number;
  /** null = no pay information: scored as neutral, never as a penalty */
  pay: number | null;
}

/**
 * Deep research on one role (lib/apply/research.ts), written by `npm run deep -- import` from a Claude session's
 * research JSON. The sourced claims themselves are `facts` rows (field `dr.<section>.<key>`); this row holds what is
 * NOT a sourced fact: what was searched for and not found, and Claude's judgement against Jonno's knowledge store
 * (requirement fit, which stories fit). The UI labels the judgement parts as Claude's read.
 */
export const roleResearch = sqliteTable("role_research", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().unique().references(() => jobs.id, { onDelete: "cascade" }),
  unknowns: text("unknowns", { mode: "json" }).$type<{ section: string; searched: string }[]>().notNull().default([]),
  fit: text("fit", { mode: "json" }).$type<FitLine[]>().notNull().default([]),
  angle: text("angle", { mode: "json" }).$type<Angle>().notNull(),
  /** Claude's rough estimate of where the role could lead, with pay ranges — judgement, never shown as fact */
  careerPath: text("career_path", { mode: "json" }).$type<CareerPath>(),
  model: text("model").notNull(),
  researchedAt: text("researched_at").notNull().default(now),
});
export interface FitLine { requirement: string; status: "meets" | "stretch" | "gap" | "unconfirmed"; evidence: string }
export interface Angle { stories: { story: string; why: string }[]; hook: string; openQuestions: string[] }
/** Pay in £k a year (base, London). `years` is time since joining, e.g. "2–4". */
export interface CareerStep { title: string; years: string; payLow: number; payHigh: number; note?: string | null }
export interface CareerPath { start: CareerStep; tracks: { name: string; why: string; steps: CareerStep[] }[]; basis: string }

export const newsItems = sqliteTable("news_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  url: text("url").notNull().unique(),
  publishedAt: text("published_at"),
  sourceName: text("source_name"),
}, (t) => [index("news_company_idx").on(t.companyId)]);

// ---------- Layer 3: user ----------
export const applications = sqliteTable("applications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().unique().references(() => jobs.id),
  status: text("status").$type<ApplicationStatus>().notNull().default("discovered"),
  nextAction: text("next_action"),
  nextActionDue: text("next_action_due"),
  notes: text("notes"),
  appliedAt: text("applied_at"),
  dismissedReason: text("dismissed_reason"),
  /** the employer's own application form URL and the role title its pages show; the Gmail sync uses the title to
   *  tell same-company roles apart (one employer's form and confirmation named different tracks). Set by a run. */
  formUrl: text("form_url"),
  employerTitle: text("employer_title"),
  updatedAt: text("updated_at").notNull().default(now),
});

export const RUN_KINDS = ["apply", "research"] as const;
export type RunKind = (typeof RUN_KINDS)[number];
/** queued → running → (needs_you → queued …) → ready → done. failed/cancelled are terminal. */
export const RUN_STATES = ["queued", "running", "needs_you", "ready", "done", "failed", "cancelled"] as const;
export type RunState = (typeof RUN_STATES)[number];
export const ACTIVE_RUN_STATES = ["queued", "running", "needs_you", "ready"] as const;

/**
 * One click of Apply or Research (docs/superpowers/specs/2026-09-30-one-click-apply-and-research-runner.md).
 * `note` is the one line the agent keeps updated; the employer's form is the real state. Layer 3: written by the app's
 * server actions and the runner only. A partial unique index allows one active run per (job, kind).
 */
export const agentRuns = sqliteTable("agent_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").$type<RunKind>().notNull(),
  jobId: integer("job_id").notNull().references(() => jobs.id),
  applicationId: integer("application_id").references(() => applications.id, { onDelete: "set null" }),
  state: text("state").$type<RunState>().notNull().default("queued"),
  formUrl: text("form_url"),
  note: text("note"),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  heartbeatAt: text("heartbeat_at"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  createdAt: text("created_at").notNull().default(now),
}, (t) => [
  index("agent_runs_state_idx").on(t.state),
  uniqueIndex("agent_runs_one_active").on(t.jobId, t.kind).where(sql`state in ('queued','running','needs_you','ready')`),
]);

export const QUESTION_KINDS = ["fact", "declaration", "choice", "login", "review"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

/** A thing a run needs from Jonno. Answering the last open one re-queues the run. */
export const runQuestions = sqliteTable("run_questions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  kind: text("kind").$type<QuestionKind>().notNull(),
  prompt: text("prompt").notNull(),
  options: text("options", { mode: "json" }).$type<string[] | null>(),
  /** the answer should be saved to profile/facts.yaml for every future form */
  standing: integer("standing", { mode: "boolean" }).notNull().default(false),
  factKey: text("fact_key"),
  answer: text("answer"),
  answeredAt: text("answered_at"),
  createdAt: text("created_at").notNull().default(now),
}, (t) => [index("run_questions_run_idx").on(t.runId)]);

export const activityLog = sqliteTable("activity_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  applicationId: integer("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  note: text("note"),
  at: text("at").notNull().default(now),
}, (t) => [index("activity_app_idx").on(t.applicationId)]);

export const ANSWER_STATUSES = ["draft", "approved", "submitted"] as const;
export type AnswerStatus = (typeof ANSWER_STATUSES)[number];

/**
 * Free-text answers for one application. A Claude drafting run inserts `draft`s (`npm run track -- draft`); Jonno
 * edits and approves them on the role page; the form-filler reads only `approved` ones (`track -- answers`) and marks
 * them `submitted`. The same question text is unique per application, so a re-draft replaces a draft in place but
 * never touches an approved or submitted answer.
 */
export const applicationAnswers = sqliteTable("application_answers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  applicationId: integer("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  wordLimit: integer("word_limit"),
  charLimit: integer("char_limit"),
  text: text("text").notNull(),
  status: text("status").$type<AnswerStatus>().notNull().default("draft"),
  /** open [ASK: …] gaps the drafter could not fill from the knowledge store */
  gaps: text("gaps", { mode: "json" }).$type<string[]>().notNull().default([]),
  /** URLs / store files each claim came from */
  sources: text("sources", { mode: "json" }).$type<string[]>().notNull().default([]),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
}, (t) => [uniqueIndex("application_answers_app_q_uq").on(t.applicationId, t.question)]);

/**
 * Recruiter emails, one row per Gmail message (so a re-run never double-applies one). Written only by
 * `npm run track -- record` on Jonno's behalf — see lib/tracker/email.ts. `applicationId` is null when the
 * email matched nothing tracked; the Applications page lists those so they can be linked by hand.
 */
export const emailUpdates = sqliteTable("email_updates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  gmailMessageId: text("gmail_message_id").notNull().unique(),
  threadId: text("thread_id"),
  viewUrl: text("view_url"),
  receivedAt: text("received_at").notNull(),
  sender: text("sender").notNull(),
  subject: text("subject").notNull(),
  kind: text("kind").$type<EmailKind>().notNull(),
  summary: text("summary"),
  companyHint: text("company_hint"),
  roleHint: text("role_hint"),
  applicationId: integer("application_id").references(() => applications.id, { onDelete: "set null" }),
  /** the status this email moved the application to, or null if it moved nothing */
  statusApplied: text("status_applied"),
  actionText: text("action_text"),
  actionDue: text("action_due"),
  actionDone: integer("action_done", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(now),
}, (t) => [index("email_updates_app_idx").on(t.applicationId)]);

// ---------- Ops ----------
export const sweepRuns = sqliteTable("sweep_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: text("started_at").notNull().default(now),
  finishedAt: text("finished_at"),
  trigger: text("trigger").$type<"cli" | "ui">().notNull().default("cli"),
  summary: text("summary", { mode: "json" }).$type<Record<string, unknown>>(),
});

export const sweepRunSources = sqliteTable("sweep_run_sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id").notNull().references(() => sweepRuns.id, { onDelete: "cascade" }),
  source: text("source").$type<Source>().notNull(),
  status: text("status").$type<"ok" | "failed" | "skipped">().notNull(),
  discovered: integer("discovered").notNull().default(0),
  inserted: integer("inserted").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  error: text("error"),
  durationMs: integer("duration_ms").notNull().default(0),
}, (t) => [index("sweep_run_sources_run_idx").on(t.runId)]);

export type Company = typeof companies.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Fact = typeof facts.$inferSelect;
export type RoleEvaluation = typeof roleEvaluations.$inferSelect;
export type RoleResearch = typeof roleResearch.$inferSelect;
export type Application = typeof applications.$inferSelect;
