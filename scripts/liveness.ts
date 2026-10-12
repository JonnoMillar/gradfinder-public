/**
 * npm run liveness [-- --limit N] [--ids 1,2] [--force]
 *   npm run liveness -- --ids 1915 --url <employer page>   check one role against a page it doesn't store (e.g. the
 *   employer's own careers page when the job board 403s)
 *   Ask each kept role's employer (their ATS API, else the page) whether the posting is still open, store the
 *   answer as a `liveness` fact with the URL checked, then refilter + rerank so closed roles leave the list.
 *   Skips roles checked in the last 20 h unless --force. Run it after a sweep.
 */
import { parseArgs } from "node:util";
import pLimit from "p-limit";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "../lib/db/client";
import type { Confidence, FactSourceKind } from "../lib/db/schema";
import { checkPosting, checkUrl, isBoardUrl, type LivenessCheck } from "../lib/pipeline/liveness";
import { rankAll } from "../lib/pipeline/rank";
import { refilter } from "../lib/pipeline/refilter";

const RECHECK_AFTER_MS = 20 * 3_600_000;

async function main() {
  const { values } = parseArgs({ options: { limit: { type: "string" }, ids: { type: "string" }, force: { type: "boolean", default: false }, url: { type: "string" } } });
  const db = getDb();
  const ids = values.ids?.split(",").map(Number).filter(Boolean);
  let jobs = db.select({ id: schema.jobs.id, title: schema.jobs.title, applyUrl: schema.jobs.applyUrl, canonicalUrl: schema.jobs.canonicalUrl, company: schema.companies.name })
    .from(schema.jobs).innerJoin(schema.companies, eq(schema.companies.id, schema.jobs.companyId))
    .where(ids ? inArray(schema.jobs.id, ids) : and(eq(schema.jobs.isActive, true), isNull(schema.jobs.excludedReason))).all();

  if (!values.force && !ids) {
    const recent = new Set(db.select({ id: schema.facts.entityId, at: schema.facts.fetchedAt }).from(schema.facts)
      .where(and(eq(schema.facts.entityType, "job"), eq(schema.facts.field, "liveness"))).all()
      .filter((f) => f.at && Date.now() - Date.parse(f.at) < RECHECK_AFTER_MS).map((f) => f.id));
    jobs = jobs.filter((j) => !recent.has(j.id));
  }
  if (values.limit) jobs = jobs.slice(0, Number(values.limit));
  console.log(`checking ${jobs.length} roles`);

  if (values.url && ids?.length !== 1) throw new Error("--url needs exactly one --ids");

  const lim = pLimit(8);
  let done = 0;
  const results = await Promise.all(jobs.map((j) => lim(async () => {
    const r = values.url ? await checkUrl(values.url) : await checkPosting(j);
    write(j.id, r);
    if (++done % 50 === 0) console.log(`  ${done}/${jobs.length}`);
    return { j, r };
  })));

  const by = (k: (x: { r: LivenessCheck }) => string) => results.reduce<Record<string, number>>((a, x) => ((a[k(x)] = (a[k(x)] ?? 0) + 1), a), {});
  console.log("\nstatus:", by((x) => x.r.status));
  console.log("closed via:", by((x) => (x.r.status === "closed" ? x.r.via : "-")));
  console.log("unknown because:", by((x) => (x.r.status === "unknown" ? x.r.evidence.replace(/\(.*$|https?:\S+/g, "").slice(0, 40) : "-")));
  console.log("\nclosed:");
  for (const { j, r } of results.filter((x) => x.r.status === "closed")) console.log(`  #${j.id} ${j.company} — ${j.title.slice(0, 60)}\n      ${r.evidence}  ← ${r.url}`);

  const rf = refilter();
  console.log(`\nrefilter: ${rf.newlyExcluded} newly excluded, ${rf.newlyKept} newly kept; by reason`, rf.byReason);
  console.log(`ranked ${rankAll()} active jobs`);
}

function write(jobId: number, r: LivenessCheck) {
  if (!r.url) return;   // every fact cites its URL; a role with no posting URL at all simply stays unchecked
  const db = getDb();
  const kind: FactSourceKind = r.via === "page" ? (isBoardUrl(r.url) ? "posting" : "company_site") : "ats";
  const confidence: Confidence = r.via === "page" ? "medium" : "high";
  db.transaction(() => {
    db.delete(schema.facts).where(and(eq(schema.facts.entityType, "job"), eq(schema.facts.entityId, jobId), eq(schema.facts.field, "liveness"))).run();
    db.insert(schema.facts).values({
      entityType: "job", entityId: jobId, field: "liveness", valueText: `${r.status}: ${r.evidence}`,
      valueJson: { value: { status: r.status, evidence: r.evidence, via: r.via, mentionsIntake: r.mentionsIntake ?? false, checkedAt: new Date().toISOString() } },
      sourceUrl: r.url, sourceKind: kind, confidence,
    }).run();
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
