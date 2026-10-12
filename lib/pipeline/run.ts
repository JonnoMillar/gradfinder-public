/**
 * Sweep orchestrator.
 *  1. open a sweep_run
 *  2. for each adapter: run it, catch SourceError, record outcome in sweep_run_sources, continue
 *  3. upsert companies / jobs / job_sources / facts from every RawPosting
 *  4. stale detection — per source that SUCCEEDED, job_sources not seen this run are stale; a job goes
 *     inactive only when all of its job_sources are stale. A failed source never deactivates anything,
 *     and neither does a --limit run, which only ever saw part of what the source lists.
 * Never touches applications / activity_log (layer 3).
 */
import { deadlineFromDescription, parseDeadlineText } from "./parse/deadline";
import { COMPANY_DOMAINS } from "@/config/company-domains";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import type { Source } from "@/lib/db/schema";
import { AdapterOutput, RawPosting, SourceAdapter, SourceError, isTouch } from "./types";
import { companySlug, dedupeKey, guessEmployerFromText, isReposter, locationBucket } from "./normalise";
import { excludedReason } from "./filter";
import { rankAll } from "./rank";
import { refilter } from "./refilter";
import { htmlToText } from "./parse/html";

export interface SweepOptions {
  adapters: SourceAdapter[];
  limit?: number;
  trigger?: "cli" | "ui";
  log?: (msg: string) => void;
}

export interface SourceOutcome {
  source: Source; status: "ok" | "failed"; discovered: number; inserted: number; updated: number; error?: string; durationMs: number;
}

export async function runSweep(opts: SweepOptions): Promise<{ runId: number; outcomes: SourceOutcome[] }> {
  const db = getDb();
  const log = opts.log ?? ((m: string) => console.log(m));
  const runStart = new Date().toISOString();
  const run = db.insert(schema.sweepRuns).values({ trigger: opts.trigger ?? "cli", startedAt: runStart }).returning({ id: schema.sweepRuns.id }).get();
  const outcomes: SourceOutcome[] = [];

  for (const adapter of opts.adapters) {
    const t0 = Date.now();
    const slog = (m: string) => log(`[${adapter.source}] ${m}`);
    let postings: AdapterOutput[] = [];
    let outcome: SourceOutcome;
    try {
      postings = await adapter.run({ limit: opts.limit, log: slog });
      if (postings.length === 0) throw new SourceError(adapter.source, "run", "adapter returned zero postings");
      const counts = ingest(postings, runStart);
      outcome = { source: adapter.source, status: "ok", discovered: postings.length, ...counts, durationMs: Date.now() - t0 };
      slog(`ok: ${postings.length} postings, ${counts.inserted} new, ${counts.updated} updated`);
    } catch (err) {
      if (process.env.DEBUG) console.error(err);
      const message = err instanceof Error ? `${err.message}${err.cause ? ` — cause: ${String((err.cause as Error)?.message ?? err.cause)}` : ""}` : String(err);
      outcome = { source: adapter.source, status: "failed", discovered: 0, inserted: 0, updated: 0, error: message, durationMs: Date.now() - t0 };
      slog(`FAILED: ${message}`);
    }
    outcomes.push(outcome);
    db.insert(schema.sweepRunSources).values({ runId: run.id, ...outcome }).run();
  }

  // A --limit run deliberately looks at a slice, so "not seen this run" says nothing about the rest:
  // without this, `npm run sweep -- --limit 20` quietly deactivates every other job the source lists.
  const limited = opts.limit !== undefined;
  const deactivated = limited ? 0 : markStale(outcomes.filter((o) => o.status === "ok").map((o) => o.source), runStart);
  // one keep/drop decision for every active job, from everything stored (not just what this run saw)
  const rf = refilter();
  rankAll();
  log(`refilter: ${rf.checked} active jobs, ${rf.newlyExcluded} newly excluded, ${rf.newlyKept} newly kept`);
  db.update(schema.sweepRuns)
    .set({ finishedAt: new Date().toISOString(), summary: { outcomes, deactivated } })
    .where(eq(schema.sweepRuns.id, run.id)).run();
  log(`sweep #${run.id} done: ${outcomes.filter((o) => o.status === "ok").length}/${outcomes.length} sources ok, ${limited ? "stale detection skipped (--limit)" : `${deactivated} jobs deactivated`}`);
  return { runId: run.id, outcomes };
}

// ---------------------------------------------------------------------------------------------

function ingest(postings: AdapterOutput[], runStart: string): { inserted: number; updated: number } {
  const db = getDb();
  let inserted = 0, updated = 0;
  db.transaction(() => {
    for (const p of postings) {
      if (isTouch(p)) { if (touch(p, runStart)) updated++; continue; }
      const companyId = upsertCompany(p);
      const { jobId, isNew } = upsertJob(p, companyId, runStart);
      upsertJobSource(p, jobId, runStart);
      writeFacts(p, jobId, companyId);
      if (isNew) inserted++; else updated++;
    }
  });
  return { inserted, updated };
}

function resolveCompanyName(p: RawPosting): string {
  if (!isReposter(p.companyName)) return p.companyName;
  return guessEmployerFromText(p.title, p.descriptionText) ?? p.companyName;
}

function upsertCompany(p: RawPosting): number {
  const db = getDb();
  const name = resolveCompanyName(p);
  const slug = companySlug(name);
  const existing = db.select({ id: schema.companies.id, logoUrl: schema.companies.logoUrl, website: schema.companies.website, domain: schema.companies.domain })
    .from(schema.companies).where(eq(schema.companies.slug, slug)).get();
  if (existing) {
    // fill blanks only; never overwrite researched values with source scraps
    const patch: Partial<typeof schema.companies.$inferInsert> = {};
    if (!existing.logoUrl && p.logoUrl) patch.logoUrl = p.logoUrl;
    if (!existing.website && p.companyUrl) patch.website = p.companyUrl;
    // a verified domain from config/company-domains.ts gives the company a logo when no source had one
    if (!existing.domain && COMPANY_DOMAINS[slug]) patch.domain = COMPANY_DOMAINS[slug];
    if (Object.keys(patch).length) db.update(schema.companies).set(patch).where(eq(schema.companies.id, existing.id)).run();
    return existing.id;
  }
  const row = db.insert(schema.companies).values({
    slug, name, logoUrl: p.logoUrl, website: p.companyUrl, domain: domainOf(p.companyUrl) ?? COMPANY_DOMAINS[slug] ?? null,
    aliases: name !== p.companyName ? [p.companyName] : [],
  }).returning({ id: schema.companies.id }).get();
  return row.id;
}

function upsertJob(p: RawPosting, companyId: number, runStart: string): { jobId: number; isNew: boolean } {
  const db = getDb();
  const name = resolveCompanyName(p);
  const key = dedupeKey(name, p.title, p.locationRaw);
  const descriptionText = p.descriptionText ?? (p.descriptionHtml ? htmlToText(p.descriptionHtml) : undefined);
  const base = {
    title: p.title,
    descriptionText,
    descriptionHtml: p.descriptionHtml,
    locationRaw: p.locationRaw,
    isLondon: locationBucket(p.locationRaw) === "london",
    salaryMin: p.salaryMin, salaryMax: p.salaryMax, salaryCurrency: p.salaryCurrency, salaryText: p.salaryText,
    // no structured date: read one from the deadline text ("29th Sep 2026"); undefined leaves a stored one alone
    deadline: p.deadline ?? parseDeadlineText(p.deadlineText) ?? deadlineFromDescription(descriptionText) ?? undefined, deadlineText: p.deadlineText, startText: p.startText,
    applyUrl: p.applyUrl, canonicalUrl: p.url,
    // first pass from the posting alone; refilter() at the end of the run adds what extraction and the
    // liveness check know (entry level, function, closed) — see lib/pipeline/refilter.ts
    excludedReason: excludedReason({ title: p.title, locationRaw: p.locationRaw, kindHint: p.kindHint, kind: kindFromHint(p.kindHint), startText: p.startText, description: descriptionText, deadline: p.deadline }),
    lastSeen: runStart, isActive: true,
  };
  const existing = db.select({ id: schema.jobs.id, contentHash: schema.jobs.contentHash, excludedReason: schema.jobs.excludedReason, function: schema.jobs.function })
    .from(schema.jobs).where(eq(schema.jobs.dedupeKey, key)).get();
  if (existing) {
    // Always re-derive parsed fields (parsers improve over time). The LLM extraction cache is keyed on
    // content_hash separately, so this never forces a re-extraction by itself.
    // excluded_reason is not re-derived here from the posting alone: that dropped the LLM's entry-level verdict
    // and function tag on every re-sweep. refilter() at the end of runSweep recomputes it from everything stored.
    const { excludedReason: _fromPostingOnly, ...rest } = base;
    const patch: Partial<typeof schema.jobs.$inferInsert> = { ...rest, contentHash: p.contentHash ?? existing.contentHash ?? undefined };
    db.update(schema.jobs).set(stripUndefined(patch)).where(eq(schema.jobs.id, existing.id)).run();
    return { jobId: existing.id, isNew: false };
  }
  const row = db.insert(schema.jobs).values({
    ...base, companyId, dedupeKey: key, contentHash: p.contentHash, firstSeen: runStart,
    kind: kindFromHint(p.kindHint),
  }).returning({ id: schema.jobs.id }).get();
  return { jobId: row.id, isNew: true };
}

/** "Still listed, not re-fetched": bump last_seen on the job_source and the job so stale detection keeps it. */
function touch(p: { source: schema.Source; sourceId: string }, runStart: string): boolean {
  const db = getDb();
  const js = db.select({ id: schema.jobSources.id, jobId: schema.jobSources.jobId }).from(schema.jobSources)
    .where(and(eq(schema.jobSources.source, p.source), eq(schema.jobSources.sourceId, p.sourceId))).get();
  if (!js) return false;
  db.update(schema.jobSources).set({ lastSeen: runStart }).where(eq(schema.jobSources.id, js.id)).run();
  db.update(schema.jobs).set({ lastSeen: runStart, isActive: true }).where(eq(schema.jobs.id, js.jobId)).run();
  return true;
}

function upsertJobSource(p: RawPosting, jobId: number, runStart: string) {
  const db = getDb();
  db.insert(schema.jobSources)
    .values({ jobId, source: p.source, sourceId: p.sourceId, url: p.url, snapshotId: p.snapshotId ?? null, firstSeen: runStart, lastSeen: runStart, lastFetched: runStart })
    .onConflictDoUpdate({
      target: [schema.jobSources.source, schema.jobSources.sourceId],
      set: { lastSeen: runStart, lastFetched: runStart, url: p.url, snapshotId: p.snapshotId ?? null, jobId },
    }).run();
}

/** Source-provided facts with provenance. Replaces prior facts for the same (entity, field, source_url). */
function writeFacts(p: RawPosting, jobId: number, companyId: number) {
  const db = getDb();
  const put = (entityType: "company" | "job", entityId: number, field: string, valueText: string, valueJson: unknown, sourceKind: schema.FactSourceKind, confidence: schema.Confidence) => {
    db.delete(schema.facts).where(and(eq(schema.facts.entityType, entityType), eq(schema.facts.entityId, entityId), eq(schema.facts.field, field), eq(schema.facts.sourceUrl, p.url))).run();
    db.insert(schema.facts).values({ entityType, entityId, field, valueText, valueJson, sourceUrl: p.url, sourceKind, confidence }).run();
  };
  if (p.rating) put("company", companyId, "review_rating", `${p.rating.value}/${p.rating.scale} from ${p.rating.count} reviews (${p.source})`, p.rating, "reviews", "high");
  if (p.salaryMin || p.salaryText) {
    const txt = p.salaryText ?? (p.salaryMax && p.salaryMax !== p.salaryMin ? `${p.salaryCurrency ?? ""} ${p.salaryMin}–${p.salaryMax}` : `${p.salaryCurrency ?? ""} ${p.salaryMin}`).trim();
    put("job", jobId, "pay_band", txt, { min: p.salaryMin, max: p.salaryMax, currency: p.salaryCurrency }, "posting", "high");
  }
  if (p.roleTags) put("job", jobId, "role_tags", p.roleTags, undefined, "posting", "high");
  for (const f of p.extraFacts ?? []) put("company", companyId, f.field, f.valueText, f.valueJson, p.source === "indeed" || p.source === "linkedin" ? "reviews" : "posting", f.confidence);
}

function markStale(okSources: Source[], runStart: string): number {
  if (!okSources.length) return 0;
  const db = getDb();
  // job_sources from successful sources that weren't refreshed this run
  const stale = db.select({ jobId: schema.jobSources.jobId }).from(schema.jobSources)
    .where(and(inArray(schema.jobSources.source, okSources), lt(schema.jobSources.lastSeen, runStart))).all();
  const candidateIds = [...new Set(stale.map((s) => s.jobId))];
  if (!candidateIds.length) return 0;
  // a job is inactive only if NONE of its sources saw it this run
  const stillSeen = db.select({ jobId: schema.jobSources.jobId }).from(schema.jobSources)
    .where(and(inArray(schema.jobSources.jobId, candidateIds), sql`${schema.jobSources.lastSeen} >= ${runStart}`)).all();
  const seenSet = new Set(stillSeen.map((s) => s.jobId));
  const toDeactivate = candidateIds.filter((id) => !seenSet.has(id));
  if (toDeactivate.length) db.update(schema.jobs).set({ isActive: false }).where(inArray(schema.jobs.id, toDeactivate)).run();
  return toDeactivate.length;
}

// ---- helpers ----
function kindFromHint(hint?: string): schema.JobKind {
  const h = (hint ?? "").toLowerCase();
  if (h === "register_interest") return "register_interest";
  if (/scheme|programme|program/.test(h)) return "graduate_scheme";
  if (/graduate/.test(h)) return "graduate_job";
  if (/intern/.test(h)) return "internship";
  if (/placement/.test(h)) return "placement";
  if (/insight|spring/.test(h)) return "insight";
  return "unknown";
}
/** Hosts a source sometimes gives as the "company website": a job board or link shortener, never the employer, so their
 *  favicon would put the board's logo on the company (10 companies showed Indeed's or Higherin's, found 2026-10-12). */
export const NOT_EMPLOYER_HOST = /(^|\.)(indeed\.com|linkedin\.com|higherin\.com|targetjobs\.co\.uk|brightnetwork\.co\.uk|bit\.ly|pwc\.to)$/i;
export function domainOf(url?: string): string | undefined {
  try {
    const host = url ? new URL(url).hostname.replace(/^www\./, "") : undefined;
    return host && !NOT_EMPLOYER_HOST.test(host) ? host : undefined;
  } catch { return undefined; }
}
function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
