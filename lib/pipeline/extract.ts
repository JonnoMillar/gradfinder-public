/**
 * LLM extraction over description_text → structured fields on jobs.* + posting facts.
 *  - Only kept (excluded_reason null), active jobs. Skipped when extraction_meta.content_hash matches the
 *    job's current content_hash (and the previous run actually succeeded); --force overrides.
 *  - The LLM sees the posting text only (title, company name, description) — never the CV, never research.
 *  - Every extracted field is written as a `facts` row (source_kind=posting, confidence=high, source_url =
 *    the posting's canonical URL) carrying the model's verbatim evidence quote, so the UI can trace it.
 *  - `function` and `is_entry_level` re-run the deterministic filter, which may now exclude the job.
 *  - `employer_name` re-homes a job whose company row is a known reposter (targetjobs UK, …).
 *  - Chain exhausted / garbage → all-"unknown" objects, extraction_meta.provider="none", retried next run.
 */
import { deadlineFromDescription, parseDeadlineText } from "./parse/deadline";
import { createHash } from "node:crypto";
import pLimit from "p-limit";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db/client";
import type { ApplicationRequirements, Eligibility, ExtractionMeta, JobKind, TriState } from "@/lib/db/schema";
import { JOB_KINDS } from "@/lib/db/schema";
import { Chain, extract } from "@/lib/llm";
import { refilter } from "./refilter";
import { companySlug, isReposter } from "./normalise";

// ---------- taxonomy ----------
/** Primary function of the role. Keys for excluded functions match config/criteria.ts EXCLUDED_FUNCTIONS. */
export const FUNCTIONS = [
  "software_engineering", "data", "machine_learning", "quant", "product", "consulting", "strategy", "finance",
  "operations", "commercial", "research", "design", "engineering", "rotational",
  "sales", "marketing", "legal", "hr", "recruitment", "accounting", "audit", "tax", "compliance", "project_management",
  "other", "unknown",
] as const;
export type JobFunction = (typeof FUNCTIONS)[number];

// ---------- schema (lenient on the shapes small models actually produce) ----------
const triState = z.preprocess((v): TriState => {
  if (v === true || v === false) return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "yes", "required", "y"].includes(s)) return true;
    if (["false", "no", "not required", "n"].includes(s)) return false;
  }
  return "unknown";
}, z.union([z.boolean(), z.literal("unknown")]));
const strList = z.preprocess((v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => String(x).trim()) : []), z.array(z.string()));
const optText = z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : null), z.string().nullable());
/** "2.1" / "upper second" / "2:1 or above" → "2:1"; non-answers → null; other real text kept verbatim. */
const degreeClass = z.preprocess((v) => {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (!s || ["unknown", "not stated", "none", "any", "n/a", "null"].includes(s)) return null;
  if (/^(1st|1|first)\b/.test(s) || /first[- ]class/.test(s)) return "1st";
  if (/^2[.:]1\b/.test(s) || /upper[- ]second/.test(s)) return "2:1";
  if (/^2[.:]2\b/.test(s) || /lower[- ]second/.test(s)) return "2:2";
  return v.trim();
}, z.string().nullable());

export const ExtractionSchema = z.object({
  kind: z.enum(JOB_KINDS),
  function: z.enum(FUNCTIONS),
  is_entry_level: triState,
  employer_name: optText,
  eligibility: z.object({ degree_class: degreeClass, subjects: strList, visa_sponsorship: triState, other: strList }),
  application_requirements: z.object({
    cv: triState, cover_letter: triState, motivational_questions: triState, video_interview: triState,
    online_tests: triState, assessment_centre: triState, other: strList,
  }),
  process_stages: strList,
  salary_text: optText,
  start_text: optText,
  deadline_text: optText,
  /** field → short verbatim quote from the posting that supports it */
  evidence: z.preprocess((v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, q]) => typeof q === "string" && q.trim() && !["null", "none", "n/a", "unknown", "not stated"].includes(q.trim().toLowerCase())).map(([k, q]) => [k, String(q).trim()]));
  }, z.record(z.string(), z.string())),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export const UNKNOWN_ELIGIBILITY: Eligibility = { degree_class: null, subjects: [], visa_sponsorship: "unknown", other: [] };
export const UNKNOWN_REQUIREMENTS: ApplicationRequirements = {
  cv: "unknown", cover_letter: "unknown", motivational_questions: "unknown", video_interview: "unknown", online_tests: "unknown", assessment_centre: "unknown", other: [],
};

// ---------- prompt ----------
const MAX_DESCRIPTION_CHARS = 12_000;

export const SYSTEM_PROMPT = `You extract structured facts from a UK job posting for a final-year student looking at 2027-intake graduate roles.
Use ONLY the posting text you are given. Do not use outside knowledge. Do not guess: if the posting does not say, answer "unknown" (tri-state fields), null (text fields) or [] (lists).
Return ONE JSON object with exactly these keys:
{
  "kind": one of ${JSON.stringify(JOB_KINDS)},
      // graduate_scheme = structured multi-month programme / rotations / cohort; graduate_job = a normal entry-level job open to graduates;
      // register_interest = not yet open, asks you to register for a future intake; internship / placement / insight = fixed-term student programmes; other = none of these
  "function": one of ${JSON.stringify(FUNCTIONS)},   // the PRIMARY function. "rotational" only when rotations span several functions.
  "is_entry_level": true | false | "unknown",         // false ONLY if the posting requires prior professional experience (e.g. "3+ years"), a licence, or a senior title
  "employer_name": string | null,                      // the actual employer if the posting names one, else null
  "eligibility": { "degree_class": "1st" | "2:1" | "2:2" | null, "subjects": [string], "visa_sponsorship": true | false | "unknown", "other": [string] },
  "application_requirements": { "cv": tri, "cover_letter": tri, "motivational_questions": tri, "video_interview": tri, "online_tests": tri, "assessment_centre": tri, "other": [string] },
      // "other" = further MATERIALS the applicant must submit (portfolio, transcript, references, work samples). Never interview/selection stages (those go in process_stages) and never how-to-apply instructions.
  "process_stages": [string],                          // the recruitment stages in order, as the posting names them
  "salary_text": string | null,                        // verbatim, e.g. "£35,000 + benefits"
  "start_text": string | null,                         // verbatim start date / intake, e.g. "September 2027"
  "deadline_text": string | null,                      // verbatim closing date text
  "evidence": { "<key>": "<short verbatim quote>" }
      // REQUIRED for every top-level key you filled in (eligibility, application_requirements, process_stages, is_entry_level, kind, function, salary_text, start_text, deadline_text).
      // Each value is ONE contiguous span (5-25 words) copied character-for-character from the Posting section below — not the Title line, not paraphrased, no added quote marks.
}
Output the JSON object only — no prose, no markdown.`;

export function buildPrompt(job: { title: string; companyName: string; descriptionText: string }): { system: string; user: string } {
  const desc = job.descriptionText.length > MAX_DESCRIPTION_CHARS ? job.descriptionText.slice(0, MAX_DESCRIPTION_CHARS) + "\n[truncated]" : job.descriptionText;
  return { system: SYSTEM_PROMPT, user: `Title: ${job.title}\nListed by: ${job.companyName}\n\nPosting:\n${desc}` };
}
export const PROMPT_HASH = createHash("sha1").update(SYSTEM_PROMPT + JSON.stringify(Object.keys(ExtractionSchema.shape))).digest("hex").slice(0, 16);

// ---------- runner ----------
export interface ExtractRunOptions {
  chain?: Chain;
  limit?: number;
  jobIds?: number[];
  force?: boolean;
  /** parallel workers; the chain's cooldowns are shared, so a slow local model and a rate-limited API overlap */
  concurrency?: number;
  log?: (msg: string) => void;
  /** called after each job, for progress output / sampling */
  onJob?: (job: schema.Job, result: Extraction | null, meta: ExtractionMeta) => void;
}
export interface ExtractRunResult { candidates: number; skipped: number; processed: number; extracted: number; unknown: number; excludedNow: number; rehomed: number; groundedDrops: number }

export async function runExtract(opts: ExtractRunOptions = {}): Promise<ExtractRunResult> {
  const db = getDb();
  const log = opts.log ?? ((m: string) => console.log(m));
  const res: ExtractRunResult = { candidates: 0, skipped: 0, processed: 0, extracted: 0, unknown: 0, excludedNow: 0, rehomed: 0, groundedDrops: 0 };

  const where = [eq(schema.jobs.isActive, true)];
  if (opts.jobIds?.length) where.push(inArray(schema.jobs.id, opts.jobIds));
  const rows = db.select({ job: schema.jobs, companyName: schema.companies.name })
    .from(schema.jobs).innerJoin(schema.companies, eq(schema.companies.id, schema.jobs.companyId))
    .where(and(...where)).orderBy(schema.jobs.id).all();

  const todo: typeof rows = [];
  for (const r of rows) {
    if (r.job.excludedReason !== null && !opts.jobIds?.length) continue;
    res.candidates++;
    if (!opts.force && isFresh(r.job)) { res.skipped++; continue; }
    todo.push(r);
  }
  const batch = opts.limit ? todo.slice(0, opts.limit) : todo;
  log(`extract: ${res.candidates} candidates, ${res.skipped} already extracted, ${batch.length} to do${opts.limit && todo.length > batch.length ? ` (of ${todo.length})` : ""}`);

  const limit = pLimit(Math.max(1, opts.concurrency ?? 1));
  let done = 0;
  await Promise.all(batch.map(({ job, companyName }) => limit(async () => {
    const t0 = Date.now();
    const text = job.descriptionText?.trim() ?? "";
    const result = text
      ? await extract(ExtractionSchema, ...promptArgs(job, companyName), { chain: opts.chain, log: (m) => log(`  ${m}`) })
      : null;
    const meta: ExtractionMeta = {
      provider: result?.meta.provider ?? "none", model: result?.meta.model ?? "none",
      prompt_hash: PROMPT_HASH, content_hash: job.contentHash ?? "", at: new Date().toISOString(),
    };
    const grounded = result ? groundExtraction(result.data, `${job.title}\n${text}`) : null;
    const data = grounded?.data ?? null;
    const outcome = applyExtraction(job, data, meta);
    res.processed++;
    if (result) res.extracted++; else res.unknown++;
    if (outcome.excludedNow) res.excludedNow++;
    if (outcome.rehomed) res.rehomed++;
    if (grounded?.dropped.length) res.groundedDrops += grounded.dropped.length;
    log(`[${++done}/${batch.length}] #${job.id} ${job.title.slice(0, 60)} → ${result ? `${data!.kind}/${data!.function} via ${meta.provider}/${meta.model}${result.meta.repaired ? " (repaired)" : ""}` : "UNKNOWN (chain exhausted)"}${outcome.excludedNow ? ` → excluded: ${outcome.excludedReason}` : ""}${outcome.rehomed ? ` → employer: ${outcome.rehomed}` : ""}${grounded?.dropped.length ? ` (ungrounded, dropped: ${grounded.dropped.join(", ")})` : ""} ${Date.now() - t0}ms`);
    opts.onJob?.(job, data, meta);
  })));
  return res;
}

function promptArgs(job: schema.Job, companyName: string): [string, string] {
  const { system, user } = buildPrompt({ title: job.title, companyName, descriptionText: job.descriptionText ?? "" });
  return [system, user];
}

/** Already extracted for this exact content by a real provider (a "none" result is always retried). */
function isFresh(job: schema.Job): boolean {
  const m = job.extractionMeta;
  return !!m && m.provider !== "none" && !!job.contentHash && m.content_hash === job.contentHash;
}

/** Write one extraction (or its absence) to jobs.* and facts. Exported for tests / the sample printer. */
export function applyExtraction(job: schema.Job, data: Extraction | null, meta: ExtractionMeta): { excludedNow: boolean; excludedReason: string | null; rehomed: string | null } {
  const db = getDb();
  let excludedNow = false, rehomed: string | null = null, reason: string | null = job.excludedReason;

  db.transaction(() => {
    if (!data) {
      db.update(schema.jobs).set({
        function: null, eligibility: UNKNOWN_ELIGIBILITY, applicationRequirements: UNKNOWN_REQUIREMENTS, processStages: [], extractionMeta: meta,
        // keep a source-derived kind; only an unset kind becomes "unknown" (it already is by default)
      }).where(eq(schema.jobs.id, job.id)).run();
      return;
    }

    // kind: the source's register_interest classification is structural (page shape) and beats the model
    const kind: JobKind = job.kind === "register_interest" ? job.kind : data.kind !== "unknown" ? data.kind : job.kind;
    const patch: Partial<typeof schema.jobs.$inferInsert> = {
      kind, function: data.function, eligibility: data.eligibility, applicationRequirements: data.application_requirements,
      processStages: data.process_stages, extractionMeta: meta,
      // source-parsed text wins (it came from structured fields); the LLM fills blanks only
      salaryText: job.salaryText ?? data.salary_text, startText: job.startText ?? data.start_text, deadlineText: job.deadlineText ?? data.deadline_text,
    };

    if (data.employer_name) {
      const current = db.select({ name: schema.companies.name }).from(schema.companies).where(eq(schema.companies.id, job.companyId)).get();
      if (current && isReposter(current.name) && !isReposter(data.employer_name)) {
        patch.companyId = upsertCompanyByName(data.employer_name);
        rehomed = data.employer_name;
      }
    }
    // a closing date the posting states only in words becomes the deadline (never overwrites a structured one)
    if (!job.deadline) {
      const d = parseDeadlineText(patch.deadlineText) ?? deadlineFromDescription(job.descriptionText);
      if (d) patch.deadline = d;
    }
    db.update(schema.jobs).set(patch).where(eq(schema.jobs.id, job.id)).run();

    // posting facts with evidence — replaces prior posting-derived rows for the same field
    const url = job.canonicalUrl ?? job.applyUrl ?? "";
    const posting = `${job.title}\n${job.descriptionText ?? ""}`;
    const put = (field: string, valueText: string, value: unknown) => {
      // verified = the model's quote really occurs in the posting; the UI can show unverified fields with a warning
      const evidence = data.evidence[field] ?? null;
      const verified = evidence !== null && quoteInText(evidence, posting);
      db.delete(schema.facts).where(and(eq(schema.facts.entityType, "job"), eq(schema.facts.entityId, job.id), eq(schema.facts.field, field), eq(schema.facts.sourceKind, "posting"), eq(schema.facts.sourceUrl, url))).run();
      db.insert(schema.facts).values({ entityType: "job", entityId: job.id, field, valueText, valueJson: { value, evidence, verified }, sourceUrl: url, sourceKind: "posting", confidence: "high" }).run();
    };
    put("is_entry_level", String(data.is_entry_level), data.is_entry_level);   // kept even when "unknown": a silent non-answer must stay visible
    put("eligibility", eligibilityText(data.eligibility), data.eligibility);
    put("application_requirements", requirementsText(data.application_requirements), data.application_requirements);
    put("process_stages", data.process_stages.join(" → ") || "not stated", data.process_stages);
    if (data.salary_text) put("salary_text", data.salary_text, data.salary_text);
    if (data.start_text) put("start_text", data.start_text, data.start_text);
    if (data.deadline_text) put("deadline_text", data.deadline_text, data.deadline_text);
    if (rehomed) put("employer_name", rehomed, rehomed);

    // the keep/drop decision comes from the one rule set, now that function, kind, start text and the
    // is_entry_level fact are all written
    refilter([job.id], { inTransaction: true });
    reason = db.select({ r: schema.jobs.excludedReason }).from(schema.jobs).where(eq(schema.jobs.id, job.id)).get()?.r ?? null;
    excludedNow = reason !== null && job.excludedReason === null;
  });

  return { excludedNow, excludedReason: reason, rehomed };
}

function upsertCompanyByName(name: string): number {
  const db = getDb();
  const slug = companySlug(name);
  const existing = db.select({ id: schema.companies.id }).from(schema.companies).where(eq(schema.companies.slug, slug)).get();
  if (existing) return existing.id;
  return db.insert(schema.companies).values({ slug, name }).returning({ id: schema.companies.id }).get().id;
}

// ---------- grounding ----------
/** A positive claim must have its keyword somewhere in the posting; otherwise it becomes unknown/null. */
const GROUNDING: Record<keyof Omit<ApplicationRequirements, "other">, RegExp> = {
  cv: /\b(cv|cvs|r[ée]sum[ée]|curriculum vitae)\b/i,
  cover_letter: /\bcover(ing)?[ -]letter\b/i,
  motivational_questions: /\b(motivation(al)?|competency|application|written)[ -]?(question|answer)s?\b|\bwhy (do you want|are you interested)\b/i,
  video_interview: /\bvideo\b/i,
  online_tests: /\b(test|tests|testing|assessment|assessments|shl|numerical|psychometric|situational judgement|game[- ]based)\b/i,
  assessment_centre: /\bassessment[ -](cent(re|er)|day)\b|\bAC\b/,
};
const DEGREE_CLASS_MENTION: Record<string, RegExp> = {
  "1st": /\b(1st|first)[- ]?(class)?\b/i,
  "2:1": /\b(2[.:]1|upper[- ]second|two[- ]one)\b/i,
  "2:2": /\b(2[.:]2|lower[- ]second|two[- ]two)\b/i,
};

/**
 * Small models assert requirements that are not in the text (llama3.1 gave Savills a 2:1, a cover letter and a
 * video interview it never mentioned). Every `true` and every degree class / subject must be backed by at least
 * the relevant keyword in the posting, else it is downgraded. `false`/"unknown" are never changed.
 */
export function groundExtraction(data: Extraction, postingText: string): { data: Extraction; dropped: string[] } {
  const dropped: string[] = [];
  const text = postingText.toLowerCase();
  const out: Extraction = structuredClone(data);

  const dc = out.eligibility.degree_class;
  if (dc) {
    const re = DEGREE_CLASS_MENTION[dc];
    if (re ? !re.test(postingText) : !text.includes(dc.toLowerCase())) { out.eligibility.degree_class = null; dropped.push("eligibility.degree_class"); }
  }
  const subjects = out.eligibility.subjects.filter((s) => text.includes(s.toLowerCase()) || s.toLowerCase().split(/\W+/).filter((w) => w.length > 3).some((w) => text.includes(w)));
  if (subjects.length !== out.eligibility.subjects.length) { out.eligibility.subjects = subjects; dropped.push("eligibility.subjects"); }
  if (out.eligibility.visa_sponsorship !== "unknown" && !/\b(sponsor|visa|right to work|work permit|immigration)\b/i.test(postingText)) {
    out.eligibility.visa_sponsorship = "unknown"; dropped.push("eligibility.visa_sponsorship");
  }
  for (const key of Object.keys(GROUNDING) as (keyof typeof GROUNDING)[]) {
    if (out.application_requirements[key] === true && !GROUNDING[key].test(postingText)) {
      out.application_requirements[key] = "unknown"; dropped.push(`application_requirements.${key}`);
    }
  }
  const other = cleanRequirementsOther(out.application_requirements.other, out.process_stages);
  if (other.length !== out.application_requirements.other.length) { out.application_requirements.other = other; dropped.push("application_requirements.other"); }
  return { data: out, dropped };
}

/** "please apply through our careers portal", "Drop us your application", "click 'Apply'" — instructions, not materials. */
const APPLY_INSTRUCTION = /^(please\s+)?(apply|submit|click|drop|send)\b.*\b(apply|application|portal|careers?)\b|\bapply (through|via|online|here)\b/i;
/**
 * The audit (Stage 4 task 0) found models copying the interview stages into `application_requirements.other`
 * and filing "how to apply" sentences there. Both are deterministic to spot: drop anything that is also a
 * process stage, and anything that reads as an apply-instruction rather than a material to submit.
 */
export function cleanRequirementsOther(other: string[], stages: string[]): string[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const stageSet = new Set(stages.map(norm));
  return other.filter((o) => !stageSet.has(norm(o)) && !APPLY_INSTRUCTION.test(o.trim()));
}

/** Is the model's evidence quote really in the posting? Loose on case, whitespace and curly quotes only. */
export function quoteInText(quote: string, text: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[‘’‚‛]/g, "'").replace(/[“”„‟]/g, '"').replace(/\s+/g, " ").trim();
  const q = norm(quote).replace(/^["'«]+|["'»]+$/g, "").trim();
  return q.length > 0 && norm(text).includes(q);
}

export function eligibilityText(e: Eligibility): string {
  const parts: string[] = [];
  if (e.degree_class) parts.push(`${e.degree_class} required`);
  if (e.subjects.length) parts.push(`subjects: ${e.subjects.join(", ")}`);
  if (e.visa_sponsorship !== "unknown") parts.push(e.visa_sponsorship ? "visa sponsorship available" : "no visa sponsorship");
  parts.push(...e.other);
  return parts.join("; ") || "not stated";
}
export function requirementsText(r: ApplicationRequirements): string {
  const yes = (Object.keys(r) as (keyof ApplicationRequirements)[]).filter((k) => k !== "other" && r[k] === true).map((k) => k.replace(/_/g, " "));
  return [...yes, ...r.other].join(", ") || "not stated";
}
