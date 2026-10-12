/**
 * Company research — per `companies` row, two phases so the free LLM tier is never the reason a fetch is repeated:
 *
 *  gather   Wikipedia lead, Google News (30d), DuckDuckGo snippets for three queries. Everything is written as it
 *           is: `what_they_do` fact from Wikipedia (medium), `news_items`, one `search_snippets` fact per query
 *           (low, the DDG URL as its source). Sets `research_updated_at`. No LLM involved.
 *  classify The LLM sees ONLY those numbered sources (plus the employer's own posting blurb already in `facts`)
 *           and returns sector, ai_forward (0–3) and claims; every claim must name a source URL from that list
 *           and a verbatim quote that occurs in that source's text, else it is dropped. Claim confidence follows
 *           the source kind: posting high · wikipedia/news medium · search snippet low. Writes `companies.sector`
 *           / `ai_forward` / `ai_forward_rationale` and `sector`/`ai_forward` facts.
 *
 *  A company in `ATS_WATCHLIST` keeps the sector Jonno gave it in config — the LLM never overrides it.
 *  A company with nothing findable ends up with an empty factfile, not filler. The LLM chain being exhausted
 *  leaves sector/ai_forward null and the row is picked up by the next run without refetching.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { ATS_WATCHLIST, SECTOR_WEIGHTS } from "@/config/criteria";
import { getDb, schema } from "@/lib/db/client";
import type { Confidence, FactSourceKind } from "@/lib/db/schema";
import { Chain, extract } from "@/lib/llm";
import { quoteInText } from "@/lib/pipeline/extract";
import { googleNews, NewsItem } from "./news";
import { duckduckgo, SearchError, SearchResult, searchUrl } from "./search";
import { wikipediaSummary, WikiSummary } from "./wikipedia";

// ---------- taxonomy ----------
export const SECTORS = Object.keys(SECTOR_WEIGHTS) as (keyof typeof SECTOR_WEIGHTS & string)[];
export const CLAIM_FIELDS = ["pay_band", "competitiveness", "culture", "hybrid_policy", "scheme_structure", "process", "headcount", "funding", "what_they_do", "london_office"] as const;
export type ClaimField = (typeof CLAIM_FIELDS)[number];

/** Quoted-phrase queries; a parenthetical ("Financial Conduct Authority (FCA)") would make the phrase unmatchable. */
export function searchQueries(name: string): string[] {
  const n = name.replace(/\s*\(.*?\)/g, "").trim() || name;
  return [`"${n}" graduate salary`, `"${n}" graduate scheme applications per place`, `"${n}" culture glassdoor`];
}

// ---------- sources: what the LLM is allowed to see ----------
export interface ResearchSource { url: string; kind: FactSourceKind; label: string; text: string }
export interface Gathered {
  /** undefined = not fetched this time (partial gather); null = fetched, nothing usable */
  wiki?: WikiSummary | null;
  news?: { items: NewsItem[]; url: string };
  searches: { query: string; url: string; results: SearchResult[] }[];
  /** queries that failed (DDG bot check / cooldown); their snippets are simply missing until a later run */
  searchErrors: string[];
}

export interface Fetchers {
  wikipedia?: typeof wikipediaSummary;
  news?: typeof googleNews;
  search?: typeof duckduckgo;
}
export interface GatherParts { wiki?: boolean; news?: boolean; queries?: string[] }

/**
 * Phase 1: fetch. Wikipedia 404 / non-org = null (fine). News failure throws (it is one request; if it fails the
 * network is the problem). A search failure is recorded, not thrown: DDG rate-limits in bursts and the wiki + news
 * evidence is still worth classifying now. `parts` lets a later run fetch only the queries that are still missing.
 */
export async function gather(name: string, f: Fetchers = {}, parts: GatherParts = {}): Promise<Gathered> {
  const { wiki: doWiki = true, news: doNews = true, queries = searchQueries(name) } = parts;
  const out: Gathered = { searches: [], searchErrors: [] };
  if (doWiki) out.wiki = await (f.wikipedia ?? wikipediaSummary)(name);
  if (doNews) out.news = await (f.news ?? googleNews)(name);
  for (const query of queries) {
    try {
      const r = await (f.search ?? duckduckgo)(query);
      out.searches.push({ query, url: r.url, results: r.results });
    } catch (e) {
      if (!(e instanceof SearchError)) throw e;
      out.searchErrors.push(e.message);
    }
  }
  return out;
}

/** The queries whose snippets this company does not have yet (by the DDG URL each `search_snippets` fact cites). */
export function missingQueries(companyId: number, name: string): string[] {
  const have = new Set(getDb().select({ url: schema.facts.sourceUrl }).from(schema.facts)
    .where(and(eq(schema.facts.entityType, "company"), eq(schema.facts.entityId, companyId), eq(schema.facts.field, "search_snippets"))).all().map((r) => r.url));
  return searchQueries(name).filter((q) => !have.has(searchUrl(q)));
}

const CONFIDENCE: Record<FactSourceKind, Confidence> = { posting: "high", ats: "high", reviews: "high", company_site: "medium", wikipedia: "medium", news: "medium", search_snippet: "low", journey_planner: "high" };

/**
 * Write phase-1 results: only what was fetched is replaced (wiki facts + summary, news, each query's snippets);
 * sweep-derived facts always stay. research_updated_at is stamped when wiki and news were both fetched —
 * missing snippets are tracked by `missingQueries`, not by the stamp, so a blocked DDG never forces refetches.
 */
export function writeGathered(companyId: number, g: Gathered, now = new Date().toISOString()): void {
  const db = getDb();
  db.transaction(() => {
    // a wiki lead that is no longer there (404, or now rejected as the wrong entity) must take its summary with it
    let staleLead: string | null = null;
    if (g.wiki !== undefined) {
      const old = db.select({ v: schema.facts.valueText }).from(schema.facts)
        .where(and(eq(schema.facts.entityType, "company"), eq(schema.facts.entityId, companyId), eq(schema.facts.sourceKind, "wikipedia"))).all();
      staleLead = old[0]?.v ?? null;
      db.delete(schema.facts).where(and(eq(schema.facts.entityType, "company"), eq(schema.facts.entityId, companyId), eq(schema.facts.sourceKind, "wikipedia"))).run();
      if (g.wiki) db.insert(schema.facts).values({ entityType: "company", entityId: companyId, field: "what_they_do", valueText: leadSentences(g.wiki.extract, 2), valueJson: { description: g.wiki.description, extract: g.wiki.extract }, sourceUrl: g.wiki.url, sourceKind: "wikipedia", confidence: "medium" }).run();
    }
    for (const s of g.searches) {
      db.delete(schema.facts).where(and(eq(schema.facts.entityType, "company"), eq(schema.facts.entityId, companyId), eq(schema.facts.field, "search_snippets"), eq(schema.facts.sourceUrl, s.url))).run();
      db.insert(schema.facts).values({ entityType: "company", entityId: companyId, field: "search_snippets", valueText: `${s.results.length} results for ${s.query}`, valueJson: { query: s.query, results: s.results }, sourceUrl: s.url, sourceKind: "search_snippet", confidence: "low" }).run();
    }
    for (const n of g.news?.items ?? []) {
      db.insert(schema.newsItems).values({ companyId, title: n.title, url: n.url, publishedAt: n.publishedAt, sourceName: n.sourceName })
        .onConflictDoUpdate({ target: schema.newsItems.url, set: { title: n.title, publishedAt: n.publishedAt, sourceName: n.sourceName } }).run();
    }
    const company = db.select({ summary: schema.companies.summary, logoUrl: schema.companies.logoUrl, domain: schema.companies.domain }).from(schema.companies).where(eq(schema.companies.id, companyId)).get()!;
    db.update(schema.companies).set({
      researchUpdatedAt: g.wiki !== undefined && g.news !== undefined ? now : undefined,
      summary: g.wiki ? leadSentences(g.wiki.extract, 2) : company.summary === staleLead ? null : company.summary,
      logoUrl: company.logoUrl ?? (company.domain ? `https://www.google.com/s2/favicons?sz=128&domain=${company.domain}` : null),
    }).where(eq(schema.companies.id, companyId)).run();
  });
}

/** Rebuild the LLM's source list from what phase 1 (and the sweep) already stored — no refetch. */
export function sourcesFromDb(companyId: number): ResearchSource[] {
  const db = getDb();
  const out: ResearchSource[] = [];
  const order: Record<string, number> = { wikipedia: 0, posting: 1, reviews: 2, search_snippet: 3 };
  const facts = db.select().from(schema.facts).where(and(eq(schema.facts.entityType, "company"), eq(schema.facts.entityId, companyId))).orderBy(schema.facts.id).all()
    .sort((a, b) => (order[a.sourceKind] ?? 9) - (order[b.sourceKind] ?? 9));
  for (const f of facts) {
    if (f.sourceKind === "wikipedia") out.push({ url: f.sourceUrl, kind: "wikipedia", label: "Wikipedia", text: ((f.valueJson as { extract?: string } | null)?.extract ?? f.valueText) });
    else if (f.sourceKind === "search_snippet") {
      const v = f.valueJson as { query: string; results: SearchResult[] } | null;
      for (const r of v?.results ?? []) if (!out.some((s) => s.url === r.url)) out.push({ url: r.url, kind: "search_snippet", label: `Search result for ${v!.query}`, text: `${r.title} — ${r.snippet}` });
    } else if (f.field === "what_they_do" && (f.sourceKind === "posting" || f.sourceKind === "reviews")) {
      // the sweep stores one blurb per posting; ten identical Savills paragraphs teach the model nothing
      if (!out.some((s) => s.url === f.sourceUrl || s.text === f.valueText)) out.push({ url: f.sourceUrl, kind: f.sourceKind, label: f.sourceKind === "posting" ? "The employer's own job posting" : "Employer profile", text: f.valueText });
    }
  }
  const news = db.select().from(schema.newsItems).where(eq(schema.newsItems.companyId, companyId)).orderBy(desc(schema.newsItems.publishedAt)).limit(10).all();
  for (const n of news) out.push({ url: n.url, kind: "news", label: `News headline (${n.sourceName ?? "unknown"}, ${n.publishedAt?.slice(0, 10) ?? "undated"})`, text: n.title });
  return out.slice(0, 40);
}

// ---------- phase 2: LLM classification, grounded to the source list ----------
const optText = z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : null), z.string().nullable());
export const ResearchSchema = z.object({
  /** "ICE" hiring a London Market Supervision Analyst is Intercontinental Exchange, not Immigration and Customs Enforcement */
  wikipedia_matches_employer: z.preprocess((v) => (v === true || v === "true" ? true : v === false || v === "false" ? false : null), z.boolean().nullable()),
  sector: z.preprocess((v) => (typeof v === "string" && (SECTORS as string[]).includes(v.trim().toLowerCase()) ? v.trim().toLowerCase() : "unknown"), z.string()),
  sector_rationale: optText,
  sector_source_url: optText,
  ai_forward: z.preprocess((v) => { const n = typeof v === "string" ? Number(v) : v; return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 3 ? n : null; }, z.number().int().min(0).max(3).nullable()),
  ai_forward_rationale: optText,
  ai_forward_source_url: optText,
  claims: z.preprocess(
    (v) => (Array.isArray(v) ? v : []).filter((c) => c && typeof c === "object" && (CLAIM_FIELDS as readonly string[]).includes(String((c as { field?: unknown }).field)) && ["value", "source_url", "quote"].every((k) => typeof (c as Record<string, unknown>)[k] === "string" && ((c as Record<string, string>)[k]).trim())),
    z.array(z.object({ field: z.enum(CLAIM_FIELDS), value: z.string(), source_url: z.string(), quote: z.string() })),
  ),
});
export type Research = z.infer<typeof ResearchSchema>;

export const RESEARCH_SYSTEM_PROMPT = `You research a UK employer on behalf of a final-year student choosing 2027 graduate roles.
You are given numbered SOURCES: a Wikipedia lead, recent news headlines, web-search snippets and the employer's own job-posting blurb. Use ONLY these sources. No outside knowledge. If the sources do not say, leave it out.
The employer's own posting blurb and the titles of the jobs it lists in London are the ground truth for WHICH organisation this is.
Return ONE JSON object with exactly these keys:
{
  "wikipedia_matches_employer": true | false | null,
      // false if the Wikipedia source describes a different organisation from the one behind the posting blurb / job titles
      // (same or similar name, different entity); null if there is no Wikipedia source or no posting evidence to compare against
  "sector": one of ${JSON.stringify([...SECTORS, "unknown"])},
      // ai = AI lab / AI-native product company; fintech = payments, neobanks, trading platforms; quant = quant trading / market making / hedge funds;
      // deep_tech = semiconductors, robotics, biotech tooling, space; climate = energy transition, climate tech; health = pharma, medtech, healthcare;
      // defence; big_tech = large global tech platforms; consumer_tech = consumer apps/marketplaces; media; government = public sector, regulators, NHS admin;
      // energy = utilities, oil & gas, grid; consulting = professional services / consultancies / accountancy; other = anything else; unknown = sources don't say
  "sector_rationale": string | null,          // one sentence
  "sector_source_url": string | null,         // the URL of the source that supports it, copied exactly
  "ai_forward": 0 | 1 | 2 | 3 | null,
      // 0 = sources show no AI/ML in what they build or how they work; 1 = they say they adopt AI tools / have an AI initiative;
      // 2 = AI/ML is a core part of the product or a major stated programme; 3 = AI-native (AI research lab, foundation models, AI is the product). null = sources don't say
  "ai_forward_rationale": string | null,      // one sentence citing what the source says
  "ai_forward_source_url": string | null,     // URL of the supporting source, copied exactly
  "claims": [ { "field": one of ${JSON.stringify(CLAIM_FIELDS)}, "value": string, "source_url": string, "quote": string } ]
      // Only what a source states explicitly. value = short paraphrase (e.g. "£35k graduate salary", "~40 applications per place", "3 days a week in the office").
      // quote = ONE contiguous span of 5-25 words copied character-for-character from THAT source's text. source_url = that source's URL copied exactly.
      // pay_band = graduate pay figures; competitiveness = applications per place / acceptance rate; culture; hybrid_policy; scheme_structure; process = selection stages;
      // headcount; funding = funding rounds / valuation / ownership; what_they_do; london_office. Skip fields with no explicit support.
}
Output the JSON object only — no prose, no markdown.`;

export function buildResearchPrompt(name: string, sources: ResearchSource[], jobTitles: string[] = []): { system: string; user: string } {
  const body = sources.map((s, i) => `[S${i + 1}] ${s.label}\nURL: ${s.url}\n${s.text.slice(0, 1500)}`).join("\n\n");
  const titles = jobTitles.length ? `\nJobs this employer lists in London: ${jobTitles.slice(0, 6).join(" · ")}\n` : "";
  return { system: RESEARCH_SYSTEM_PROMPT, user: `Employer: ${name}\n${titles}\nSOURCES:\n${body}` };
}

/** Titles of the company's kept, active London jobs — the cheapest disambiguator we have. */
export function jobTitlesFor(companyId: number): string[] {
  return getDb().select({ title: schema.jobs.title }).from(schema.jobs)
    .where(and(eq(schema.jobs.companyId, companyId), eq(schema.jobs.isActive, true), isNull(schema.jobs.excludedReason))).limit(6).all().map((r) => r.title);
}

export interface Grounded { data: Research; dropped: string[] }

/** Every URL must be one we showed the model; every quote must occur in that source's text. */
export function groundResearch(data: Research, sources: ResearchSource[]): Grounded {
  const dropped: string[] = [];
  const out: Research = structuredClone(data);
  // a Wikipedia article about a different organisation is not evidence for anything
  const citable = out.wikipedia_matches_employer === false ? sources.filter((s) => s.kind !== "wikipedia") : sources;
  if (citable.length !== sources.length) dropped.push("wikipedia:mismatch");
  const byUrl = new Map(citable.map((s) => [s.url, s]));
  if (out.sector !== "unknown" && !(out.sector_source_url && byUrl.has(out.sector_source_url))) { out.sector = "unknown"; out.sector_source_url = null; dropped.push("sector"); }
  if (out.ai_forward !== null && !(out.ai_forward_source_url && byUrl.has(out.ai_forward_source_url))) { out.ai_forward = null; out.ai_forward_source_url = null; dropped.push("ai_forward"); }
  out.claims = out.claims.filter((c) => {
    const src = byUrl.get(c.source_url);
    const ok = !!src && quoteInText(c.quote, src.text);
    if (!ok) dropped.push(`claim:${c.field}`);
    return ok;
  });
  return { data: out, dropped };
}

export interface ClassifyResult { research: Research | null; dropped: string[]; provider: string; model: string }

export async function classify(name: string, sources: ResearchSource[], opts: { chain?: Chain; log?: (m: string) => void; jobTitles?: string[] } = {}): Promise<ClassifyResult> {
  if (!sources.length) return { research: null, dropped: [], provider: "none", model: "none" };
  const { system, user } = buildResearchPrompt(name, sources, opts.jobTitles);
  const r = await extract(ResearchSchema, system, user, { chain: opts.chain, log: opts.log });
  if (!r) return { research: null, dropped: [], provider: "none", model: "none" };
  const g = groundResearch(r.data, sources);
  return { research: g.data, dropped: g.dropped, provider: r.meta.provider, model: r.meta.model };
}

/** Write phase-2 results. Watchlist sector wins; facts carry the URL the model cited and the source-kind confidence. */
export function writeClassification(companyId: number, name: string, research: Research, sources: ResearchSource[]): void {
  const db = getDb();
  const byUrl = new Map(sources.map((s) => [s.url, s]));
  const kindOf = (url: string) => byUrl.get(url)?.kind ?? "search_snippet";
  db.transaction(() => {
    // the previous run's LLM claims go; facts written verbatim from a source (wiki lead, sweep ratings) stay
    db.delete(schema.facts).where(and(eq(schema.facts.entityType, "company"), eq(schema.facts.entityId, companyId), sql`json_extract(${schema.facts.valueJson}, '$.via') = 'llm'`)).run();

    const put = (field: string, valueText: string, valueJson: unknown, url: string) =>
      db.insert(schema.facts).values({ entityType: "company", entityId: companyId, field, valueText, valueJson, sourceUrl: url, sourceKind: kindOf(url), confidence: CONFIDENCE[kindOf(url)] }).run();

    if (research.wikipedia_matches_employer === false) {
      db.delete(schema.facts).where(and(eq(schema.facts.entityType, "company"), eq(schema.facts.entityId, companyId), eq(schema.facts.sourceKind, "wikipedia"))).run();
      db.update(schema.companies).set({ summary: null }).where(eq(schema.companies.id, companyId)).run();   // it was the wiki lead
    }
    const watch = ATS_WATCHLIST.find((w) => w.name.toLowerCase() === name.toLowerCase());
    const sector = watch ? watch.sector : research.sector === "unknown" ? null : research.sector;
    if (!watch && sector && research.sector_source_url) put("sector", `${sector}${research.sector_rationale ? ` — ${research.sector_rationale}` : ""}`, { sector, rationale: research.sector_rationale, via: "llm" }, research.sector_source_url);
    if (research.ai_forward !== null && research.ai_forward_source_url) put("ai_forward", `${research.ai_forward}/3${research.ai_forward_rationale ? ` — ${research.ai_forward_rationale}` : ""}`, { score: research.ai_forward, rationale: research.ai_forward_rationale, via: "llm" }, research.ai_forward_source_url);
    for (const c of research.claims) {
      // a claim whose source is the posting/profile is re-stated by the LLM: keep the sweep's confidence for that kind
      put(c.field, c.value, { quote: c.quote, via: "llm" }, c.source_url);
    }
    db.update(schema.companies).set({ sector, aiForward: research.ai_forward, aiForwardRationale: research.ai_forward_rationale }).where(eq(schema.companies.id, companyId)).run();
  });
}

function leadSentences(text: string, n: number): string {
  const parts = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z"“])/);
  return parts.slice(0, n).join(" ").slice(0, 600);
}
