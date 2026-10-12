/**
 * npm run research [-- --limit N] [--slugs a,b] [--force] [--all] [--no-llm] [--no-rank] [--print N] [--reclassify]
 *   --reclassify  re-run the LLM step over the stored sources for every selected company (no fetching) — after a prompt change
 *   Company research for companies with at least one kept, active job (--all: every company), most jobs first.
 *   Wikipedia + Google News are fetched when research_updated_at is older than RESEARCH_TTL_DAYS (or --force);
 *   DuckDuckGo queries whose snippets are still missing are fetched whenever search is not on cooldown; classify
 *   (LLM over the stored sources) runs when anything new was fetched or the company has no sector yet.
 *   --print N  print N researched companies' factfiles with every fact's source URL (the Stage 4 check-in gate).
 *   Fetch failures are per company: logged with the URL, counted, the company left for the next run. A DuckDuckGo
 *   bot check (HTTP 202) puts search on a 15-min cooldown; companies still get wiki + news + a classification and
 *   only the missing snippets are fetched later. Exit 1 if nothing succeeded.
 */
import { parseArgs } from "node:util";
import { and, eq, inArray, sql } from "drizzle-orm";
import { RESEARCH_TTL_DAYS } from "../config/criteria";
import { getDb, schema } from "../lib/db/client";
import { defaultChain } from "../lib/llm";
import { isReposter } from "../lib/pipeline/normalise";
import { rankAll } from "../lib/pipeline/rank";
import { classify, gather, jobTitlesFor, missingQueries, searchQueries, sourcesFromDb, writeClassification, writeGathered } from "../lib/research/orchestrator";
import { searchCoolingDownMs } from "../lib/research/search";
import { FetchError } from "../lib/pipeline/fetch";

try { process.loadEnvFile(); } catch { /* no .env: classify records nothing, gather still runs */ }

async function main() {
  const { values } = parseArgs({ options: {
    limit: { type: "string" }, slugs: { type: "string" }, force: { type: "boolean", default: false }, all: { type: "boolean", default: false },
    "no-llm": { type: "boolean", default: false }, "no-rank": { type: "boolean", default: false }, print: { type: "string", default: "0" },
    reclassify: { type: "boolean", default: false },
  } });
  const db = getDb();
  const chain = defaultChain();
  console.log(`providers: ${chain.providers.map((p) => `${p.name}[${p.models.join(", ")}]`).join(" → ") || "none"}`);

  // "companies"."id" spelled out: in a select list drizzle renders the column as a bare "id", which SQLite then
  // resolves against the subquery's own table (j.id) and the count silently becomes 1
  const keptJobs = sql<number>`(select count(*) from ${schema.jobs} j where j.company_id = "companies"."id" and j.is_active = 1 and j.excluded_reason is null)`;
  let rows = db.select({ c: schema.companies, kept: keptJobs }).from(schema.companies)
    .where(values.slugs ? inArray(schema.companies.slug, values.slugs.split(",")) : values.all ? undefined : sql`${keptJobs} > 0`)
    .orderBy(sql`${keptJobs} desc`, schema.companies.id).all();
  rows = rows.filter((r) => !isReposter(r.c.name));
  if (values.limit) rows = rows.slice(0, Number(values.limit));

  const cutoff = new Date(Date.now() - RESEARCH_TTL_DAYS * 86_400_000).toISOString();
  const stats = { companies: rows.length, gathered: 0, gatherFailed: 0, searchFailed: 0, classified: 0, llmUnknown: 0, skipped: 0, facts: 0, news: 0 };
  const done: number[] = [];
  const t0 = Date.now();

  for (const [i, { c, kept }] of rows.entries()) {
    const stale = values.force || !c.researchUpdatedAt || c.researchUpdatedAt < cutoff;
    const missing = values.force ? searchQueries(c.name) : missingQueries(c.id, c.name);
    const doSearch = missing.length > 0 && searchCoolingDownMs() === 0;
    let fetchedSomething = false;
    const tag = `[${i + 1}/${rows.length}] ${c.name} (${kept} kept jobs)`;
    if (stale || doSearch) {
      try {
        const g = await gather(c.name, {}, { wiki: stale, news: stale, queries: doSearch ? missing : [] });
        writeGathered(c.id, g);
        fetchedSomething = g.wiki !== undefined || g.searches.length > 0;
        if (stale) stats.gathered++;
        if (g.searchErrors.length) stats.searchFailed++;
        stats.news += g.news?.items.length ?? 0;
        console.log(`${tag} gathered: wiki ${g.wiki === undefined ? "(kept)" : g.wiki ? "✓" : "–"}, news ${g.news?.items.length ?? "(kept)"}, snippets ${g.searches.reduce((n, s) => n + s.results.length, 0)}${g.searchErrors.length ? ` — ${g.searchErrors.length} search(es) failed: ${g.searchErrors[0]}` : ""}`);
      } catch (e) {
        stats.gatherFailed++;
        console.log(`${tag} GATHER FAILED: ${(e as Error).message}${e instanceof FetchError ? ` ← ${e.url}` : ""}`);
        continue;   // left for the next run
      }
    }
    // classify when there is something new to read, or the row has never been classified; ai_forward null with a
    // sector set means "sources say nothing about AI" and is not re-asked until new sources arrive
    const needsClassify = !values["no-llm"] && (values.force || values.reclassify || fetchedSomething || c.sector === null);
    if (!needsClassify) { if (!stale && !doSearch) stats.skipped++; continue; }
    const sources = sourcesFromDb(c.id);
    const r = await classify(c.name, sources, { chain, log: (m) => console.log(`  ${m}`), jobTitles: jobTitlesFor(c.id) });
    if (r.research) {
      writeClassification(c.id, c.name, r.research, sources);
      stats.classified++;
      stats.facts += r.research.claims.length;
      console.log(`${tag} ${r.research.sector} / ai ${r.research.ai_forward ?? "–"} · ${r.research.claims.length} claims via ${r.provider}/${r.model}${r.dropped.length ? ` (dropped: ${r.dropped.join(", ")})` : ""}`);
    } else {
      stats.llmUnknown++;
      console.log(`${tag} LLM unknown (${sources.length} sources${sources.length ? ", chain exhausted" : ""}) — retried next run`);
    }
    done.push(c.id);
  }
  console.table([{ ...stats, seconds: Math.round((Date.now() - t0) / 1000) }]);

  const n = Number(values.print);
  for (const id of done.slice(0, n)) printFactfile(id);

  if (!values["no-rank"]) console.log(`ranked ${rankAll()} active jobs`);
  if (rows.length - stats.skipped > 0 && stats.gathered + stats.classified === 0) { console.error("nothing succeeded — network or every provider down?"); process.exitCode = 1; }
}

function printFactfile(companyId: number) {
  const db = getDb();
  const c = db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get()!;
  console.log(`\n== ${c.name}  sector=${c.sector ?? "–"}  ai_forward=${c.aiForward ?? "–"}${c.aiForwardRationale ? ` (${c.aiForwardRationale})` : ""}\n   summary: ${c.summary ?? "–"}`);
  const facts = db.select().from(schema.facts).where(and(eq(schema.facts.entityType, "company"), eq(schema.facts.entityId, companyId))).all()
    .filter((f) => f.field !== "search_snippets");
  if (!facts.length) console.log("   (no facts)");
  for (const f of facts) console.log(`   ${f.field.padEnd(16)} ${f.confidence.padEnd(6)} ${f.valueText.slice(0, 110)}\n   ${"".padEnd(23)}← ${f.sourceUrl}`);
  const news = db.select().from(schema.newsItems).where(eq(schema.newsItems.companyId, companyId)).limit(3).all();
  for (const nI of news) console.log(`   news             ${nI.publishedAt?.slice(0, 10) ?? "–"} ${nI.title} (${nI.sourceName ?? "?"})\n   ${"".padEnd(23)}← ${nI.url}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
