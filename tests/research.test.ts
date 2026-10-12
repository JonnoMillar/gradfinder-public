/**
 * Research orchestrator against a throwaway DB (the fake sources describe Monzo but the company under test is
 * "Starling Bank" — Monzo is on the config watchlist, whose sector must win, and that case has its own test) with fake fetchers and a fake LLM:
 *  - gather writes what it found verbatim (wiki lead → what_they_do, news_items, one search_snippets fact per query),
 *    every row with a source_url; a company with nothing findable gets an empty factfile
 *  - the LLM only ever sees the numbered sources; claims citing a URL it wasn't shown, or a quote not in that source,
 *    are dropped; confidence follows the source kind (snippet = low)
 *  - watchlist sector from config beats the LLM; chain exhausted → sector/ai_forward stay null, facts intact
 *  - sourcesFromDb rebuilds the same source list without refetching; rankAll then uses sector + ai_forward
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SECTOR_WEIGHTS } from "@/config/criteria";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gradfinder-research-"));
process.env.DB_PATH = path.join(tmp, "test.db");

const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
const { getDb, getSqlite, schema } = await import("@/lib/db/client");
const { eq } = await import("drizzle-orm");
const R = await import("@/lib/research/orchestrator");
const W = await import("@/lib/research/wikipedia");
type Chain = import("@/lib/llm").Chain;

const q = (sql: string, ...args: unknown[]) => getSqlite().prepare(sql).all(...args) as Record<string, any>[];

const WIKI = { title: "Monzo", description: "British neobank", extract: "Monzo Bank Limited is a British online bank. It was founded in 2015 and is based in London. It uses machine learning to detect fraud.", url: "https://en.wikipedia.org/wiki/Monzo" };
const NEWS = { items: [{ title: "Monzo posts first annual profit", url: "https://news.google.com/rss/articles/abc", publishedAt: "2026-09-01T00:00:00.000Z", sourceName: "FT" }], url: "https://news.google.com/rss/search?q=%22Monzo%22" };
const SNIPPETS = [
  { title: "Monzo graduate salary | Glassdoor", url: "https://www.glassdoor.co.uk/monzo-salaries", snippet: "Graduate Analyst salaries at Monzo are around £38,000 per year." },
  { title: "How competitive is Monzo?", url: "https://example.com/monzo-competition", snippet: "Monzo receives roughly 60 applications per graduate place." },
];
const fetchers = {
  wikipedia: async () => WIKI,
  news: async () => NEWS,
  search: async (query: string) => ({ results: SNIPPETS, url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}` }),
};
const nothing = { wikipedia: async () => null, news: async () => ({ items: [], url: "https://news.google.com/rss/search?q=x" }), search: async (query: string) => ({ results: [{ title: "Unrelated", url: "https://example.com/unrelated", snippet: "nothing here" }], url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}` }) };

function fakeChain(replies: (object | string)[]): Chain {
  let n = 0;
  return { cooldownUntil: new Map(), providers: [{ name: "fake", models: ["m"], chat: async () => { const r = replies[Math.min(n++, replies.length - 1)]; return typeof r === "string" ? r : JSON.stringify(r); } }] };
}
const exhausted: Chain = { cooldownUntil: new Map(), providers: [] };

function seedCompany(name = "Starling Bank", over: Partial<typeof schema.companies.$inferInsert> = {}) {
  return getDb().insert(schema.companies).values({ slug: name.toLowerCase().replace(/\W+/g, "-"), name, ...over }).returning().get();
}

const GOOD = {
  sector: "fintech", sector_rationale: "It is an online bank.", sector_source_url: WIKI.url,
  ai_forward: 1, ai_forward_rationale: "Uses machine learning for fraud detection.", ai_forward_source_url: WIKI.url,
  claims: [
    { field: "pay_band", value: "~£38k graduate analyst", source_url: SNIPPETS[0].url, quote: "salaries at Monzo are around £38,000 per year" },
    { field: "competitiveness", value: "~60 applications per place", source_url: SNIPPETS[1].url, quote: "roughly 60 applications per graduate place" },
    { field: "what_they_do", value: "UK online bank", source_url: WIKI.url, quote: "is a British online bank" },
  ],
};

beforeAll(() => migrate(getDb(), { migrationsFolder: path.resolve("lib/db/migrations") }));
beforeEach(() => { getSqlite().exec("delete from facts; delete from news_items; delete from jobs; delete from companies;"); });

describe("searchQueries", () => {
  it("drops parentheticals so the quoted phrase can match", () => {
    expect(R.searchQueries("Financial Conduct Authority (FCA)")[0]).toBe('"Financial Conduct Authority" graduate salary');
    expect(R.searchQueries("Monzo")).toHaveLength(3);
  });
});

describe("gather + writeGathered", () => {
  it("stores the wiki lead, news and per-query snippets, each with its source URL, and stamps research_updated_at", async () => {
    const c = seedCompany("Starling Bank", { domain: "starlingbank.com" });
    const g = await R.gather("Starling Bank", fetchers);
    R.writeGathered(c.id, g, "2026-09-21T00:00:00.000Z");
    const facts = q("select field, value_text, source_url, source_kind, confidence from facts where entity_type='company' and entity_id=? order by field", c.id);
    expect(facts.map((f) => [f.field, f.source_kind, f.confidence])).toEqual([
      ["search_snippets", "search_snippet", "low"], ["search_snippets", "search_snippet", "low"], ["search_snippets", "search_snippet", "low"],
      ["what_they_do", "wikipedia", "medium"],
    ]);
    expect(facts.find((f) => f.field === "what_they_do")).toMatchObject({ value_text: "Monzo Bank Limited is a British online bank. It was founded in 2015 and is based in London.", source_url: WIKI.url });
    for (const f of facts) expect(f.source_url).toMatch(/^https:\/\//);
    expect(q("select title, url, source_name from news_items where company_id=?", c.id)).toEqual([{ title: "Monzo posts first annual profit", url: NEWS.items[0].url, source_name: "FT" }]);
    const row = getDb().select().from(schema.companies).where(eq(schema.companies.id, c.id)).get()!;
    expect(row.researchUpdatedAt).toBe("2026-09-21T00:00:00.000Z");
    expect(row.summary).toMatch(/^Monzo Bank Limited/);
    expect(row.logoUrl).toBe("https://www.google.com/s2/favicons?sz=128&domain=starlingbank.com");
    expect(row.sector).toBeNull();
  });

  it("a wiki lead that is gone on re-gather takes its summary with it", async () => {
    const c = seedCompany();
    R.writeGathered(c.id, await R.gather("Starling Bank", fetchers));
    expect(getDb().select().from(schema.companies).where(eq(schema.companies.id, c.id)).get()!.summary).toMatch(/^Monzo Bank Limited/);
    // the entity guard now rejects the article: the fact goes, and the summary it was copied from must go too
    R.writeGathered(c.id, await R.gather("Starling Bank", { ...fetchers, wikipedia: async () => null }));
    const row = getDb().select().from(schema.companies).where(eq(schema.companies.id, c.id)).get()!;
    expect(q("select count(*) n from facts where entity_id=? and source_kind='wikipedia'", c.id)[0].n).toBe(0);
    expect(row.summary).toBeNull();
  });

  it("leaves a company with nothing findable empty — no filler", async () => {
    const c = seedCompany("Obscure Ltd");
    R.writeGathered(c.id, await R.gather("Obscure Ltd", nothing));
    expect(q("select field from facts where entity_id=? and field != 'search_snippets'", c.id)).toEqual([]);
    expect(q("select * from news_items where company_id=?", c.id)).toEqual([]);
    const row = getDb().select().from(schema.companies).where(eq(schema.companies.id, c.id)).get()!;
    expect(row.summary).toBeNull();
    expect(row.logoUrl).toBeNull();   // no domain → no favicon guess
  });

  it("clears a summary that a re-gather no longer stands behind", async () => {
    // The wrong-entity guard (titleMatchesEmployer) only helps if re-running research actually removes the
    // summary it used to accept: Attio kept GV's lead sentence until this was fixed.
    const c = seedCompany();
    R.writeGathered(c.id, await R.gather("Starling Bank", fetchers));
    expect(getDb().select().from(schema.companies).where(eq(schema.companies.id, c.id)).get()!.summary).toMatch(/^Monzo Bank Limited/);
    R.writeGathered(c.id, await R.gather("Starling Bank", { ...fetchers, wikipedia: async () => null }));
    const row = getDb().select().from(schema.companies).where(eq(schema.companies.id, c.id)).get()!;
    expect(row.summary).toBeNull();
    expect(q("select field from facts where entity_id=? and source_kind='wikipedia'", c.id)).toEqual([]);
  });

  it("keeps wiki + news when DuckDuckGo is rate-limited, records the failure, and later fetches only the missing query", async () => {
    const { SearchError, searchUrl } = await import("@/lib/research/search");
    const c = seedCompany();
    let n = 0;
    const flaky = async (query: string) => { if (++n === 2) throw new SearchError("bot check page", query, true); return fetchers.search(query); };
    const g = await R.gather("Starling Bank", { ...fetchers, search: flaky });
    expect(g.searches).toHaveLength(2);
    expect(g.searchErrors).toEqual([expect.stringContaining("bot check page")]);
    R.writeGathered(c.id, g, "2026-09-21T00:00:00.000Z");
    let row = getDb().select().from(schema.companies).where(eq(schema.companies.id, c.id)).get()!;
    expect(row.researchUpdatedAt).toBe("2026-09-21T00:00:00.000Z");   // wiki + news are complete
    expect(row.summary).toMatch(/^Monzo Bank Limited/);
    expect(q("select count(*) n from facts where entity_id=? and field='search_snippets'", c.id)[0].n).toBe(2);
    const missing = R.missingQueries(c.id, "Starling Bank");
    expect(missing).toEqual([R.searchQueries("Starling Bank")[1]]);

    // partial gather: only that query, wiki/news untouched (and not refetched)
    const calls: string[] = [];
    const g2 = await R.gather("Starling Bank", { wikipedia: async () => { calls.push("wiki"); return null; }, news: async () => { calls.push("news"); return { items: [], url: "x" }; }, search: async (query) => { calls.push(query); return fetchers.search(query); } }, { wiki: false, news: false, queries: missing });
    expect(calls).toEqual([missing[0]]);
    expect(g2.wiki).toBeUndefined();
    R.writeGathered(c.id, g2, "2026-09-22T00:00:00.000Z");
    row = getDb().select().from(schema.companies).where(eq(schema.companies.id, c.id)).get()!;
    expect(row.researchUpdatedAt).toBe("2026-09-21T00:00:00.000Z");   // partial gather does not re-stamp
    expect(R.missingQueries(c.id, "Starling Bank")).toEqual([]);
    expect(q("select count(*) n from facts where entity_id=? and field='search_snippets'", c.id)[0].n).toBe(3);
    expect(q("select count(*) n from facts where entity_id=? and source_kind='wikipedia'", c.id)[0].n).toBe(1);
    expect(q("select count(*) n from facts where entity_id=? and field='search_snippets' and source_url=?", c.id, searchUrl(missing[0]))[0].n).toBe(1);
    // a non-search error is not swallowed
    await expect(R.gather("X", { ...fetchers, news: async () => { throw new Error("ECONNRESET"); } })).rejects.toThrow("ECONNRESET");
  });

  it("re-running replaces the previous research facts instead of duplicating them", async () => {
    const c = seedCompany();
    const g = await R.gather("Starling Bank", fetchers);
    R.writeGathered(c.id, g); R.writeGathered(c.id, g);
    expect(q("select count(*) n from facts where entity_id=?", c.id)[0].n).toBe(4);
    expect(q("select count(*) n from news_items where company_id=?", c.id)[0].n).toBe(1);
  });
});

describe("classify", () => {
  it("shows the model only the gathered sources, in numbered form, with URLs", async () => {
    const c = seedCompany();
    R.writeGathered(c.id, await R.gather("Starling Bank", fetchers));
    const sources = R.sourcesFromDb(c.id);
    expect(sources.map((s) => s.kind)).toEqual(["wikipedia", "search_snippet", "search_snippet", "news"]);
    const { user } = R.buildResearchPrompt("Starling Bank", sources);
    expect(user).toContain("Employer: Starling Bank");
    expect(user).toContain("[S1] Wikipedia\nURL: https://en.wikipedia.org/wiki/Monzo");
    expect(user).toContain(SNIPPETS[1].url);
    expect(user).not.toContain("glassdoor.com/other");
  });

  it("grounds every claim to a shown URL and a verbatim quote, and scores confidence by source kind", async () => {
    const c = seedCompany();
    R.writeGathered(c.id, await R.gather("Starling Bank", fetchers));
    const sources = R.sourcesFromDb(c.id);
    const bad = { ...GOOD, claims: [...GOOD.claims,
      { field: "funding", value: "raised £500m", source_url: "https://techcrunch.com/not-shown", quote: "raised £500m" },       // URL never shown
      { field: "culture", value: "great culture", source_url: SNIPPETS[0].url, quote: "everyone loves working here" },        // quote not in that source
      { field: "headcount", value: "3,000 staff", source_url: WIKI.url, quote: "salaries at Monzo are around £38,000" },      // real quote, wrong source
    ] };
    const r = await R.classify("Starling Bank", sources, { chain: fakeChain([bad]) });
    expect(r.research!.claims.map((k) => k.field)).toEqual(["pay_band", "competitiveness", "what_they_do"]);
    expect(r.dropped).toEqual(["claim:funding", "claim:culture", "claim:headcount"]);
    R.writeClassification(c.id, "Starling Bank", r.research!, sources);
    const facts = q("select field, value_text, source_url, source_kind, confidence from facts where entity_id=? and json_extract(value_json,'$.via')='llm' order by field", c.id);
    expect(facts).toEqual([
      { field: "ai_forward", value_text: "1/3 — Uses machine learning for fraud detection.", source_url: WIKI.url, source_kind: "wikipedia", confidence: "medium" },
      { field: "competitiveness", value_text: "~60 applications per place", source_url: SNIPPETS[1].url, source_kind: "search_snippet", confidence: "low" },
      { field: "pay_band", value_text: "~£38k graduate analyst", source_url: SNIPPETS[0].url, source_kind: "search_snippet", confidence: "low" },
      { field: "sector", value_text: "fintech — It is an online bank.", source_url: WIKI.url, source_kind: "wikipedia", confidence: "medium" },
      { field: "what_they_do", value_text: "UK online bank", source_url: WIKI.url, source_kind: "wikipedia", confidence: "medium" },
    ]);
    const row = getDb().select().from(schema.companies).where(eq(schema.companies.id, c.id)).get()!;
    expect(row).toMatchObject({ sector: "fintech", aiForward: 1, aiForwardRationale: "Uses machine learning for fraud detection." });
    // the verbatim wiki fact from phase 1 survives the classification write
    expect(q("select count(*) n from facts where entity_id=? and field='what_they_do' and source_kind='wikipedia'", c.id)[0].n).toBe(2);
  });

  it("drops sector / ai_forward whose cited URL was not shown, and tolerates sloppy shapes", async () => {
    const c = seedCompany();
    R.writeGathered(c.id, await R.gather("Starling Bank", fetchers));
    const sources = R.sourcesFromDb(c.id);
    const r = await R.classify("Starling Bank", sources, { chain: fakeChain([{ sector: "Fintech", sector_source_url: "https://nowhere", ai_forward: "2", ai_forward_source_url: "https://nowhere", claims: "none" }]) });
    expect(r.research).toMatchObject({ sector: "unknown", ai_forward: null, claims: [] });
    expect(r.dropped).toEqual(["sector", "ai_forward"]);
    R.writeClassification(c.id, "Starling Bank", r.research!, sources);
    const row = getDb().select().from(schema.companies).where(eq(schema.companies.id, c.id)).get()!;
    expect(row.sector).toBeNull(); expect(row.aiForward).toBeNull();
  });

  it("keeps the config watchlist sector over the model's, and never writes a sector fact for it", async () => {
    const c = seedCompany("Anthropic");   // ATS_WATCHLIST: sector "ai"
    R.writeGathered(c.id, await R.gather("Anthropic", fetchers));
    const sources = R.sourcesFromDb(c.id);
    const r = await R.classify("Anthropic", sources, { chain: fakeChain([{ ...GOOD, sector: "consulting" }]) });
    R.writeClassification(c.id, "Anthropic", r.research!, sources);
    expect(getDb().select().from(schema.companies).where(eq(schema.companies.id, c.id)).get()!.sector).toBe("ai");
    expect(q("select * from facts where entity_id=? and field='sector'", c.id)).toEqual([]);
  });

  it("a Wikipedia article about a different organisation is dropped with everything that cited it", async () => {
    const c = seedCompany("ICE");
    getDb().insert(schema.jobs).values({ companyId: c.id, title: "Market Supervision Analyst", dedupeKey: "ice1", isLondon: true, locationRaw: "London" }).run();
    R.writeGathered(c.id, await R.gather("ICE", fetchers));
    const sources = R.sourcesFromDb(c.id);
    const { user } = R.buildResearchPrompt("ICE", sources, R.jobTitlesFor(c.id));
    expect(user).toContain("Jobs this employer lists in London: Market Supervision Analyst");
    const r = await R.classify("ICE", sources, { chain: fakeChain([{ ...GOOD, wikipedia_matches_employer: false }]), jobTitles: R.jobTitlesFor(c.id) });
    expect(r.dropped).toEqual(["wikipedia:mismatch", "sector", "ai_forward", "claim:what_they_do"]);
    expect(r.research!.claims.map((k) => k.field)).toEqual(["pay_band", "competitiveness"]);   // snippet claims survive
    R.writeClassification(c.id, "ICE", r.research!, sources);
    const row = getDb().select().from(schema.companies).where(eq(schema.companies.id, c.id)).get()!;
    expect(row).toMatchObject({ sector: null, aiForward: null, summary: null });
    expect(q("select count(*) n from facts where entity_id=? and source_kind='wikipedia'", c.id)[0].n).toBe(0);
    expect(q("select count(*) n from news_items where company_id=?", c.id)[0].n).toBe(1);   // news is not judged here
  });

  it("chain exhausted → null research, nothing written, facts from phase 1 intact", async () => {
    const c = seedCompany();
    R.writeGathered(c.id, await R.gather("Starling Bank", fetchers));
    const r = await R.classify("Starling Bank", R.sourcesFromDb(c.id), { chain: exhausted });
    expect(r).toEqual({ research: null, dropped: [], provider: "none", model: "none" });
    expect(q("select count(*) n from facts where entity_id=?", c.id)[0].n).toBe(4);
  });

  it("with no sources at all, does not call the model", async () => {
    let calls = 0;
    const chain: Chain = { cooldownUntil: new Map(), providers: [{ name: "f", models: ["m"], chat: async () => { calls++; return "{}"; } }] };
    expect((await R.classify("X", [], { chain })).research).toBeNull();
    expect(calls).toBe(0);
  });
});

/**
 * Tier 1 of the wrong-entity guard: the article title must still name the employer. All four pairs below were
 * live in the DB after the 2026-09-22 reclassify pass — the LLM's `wikipedia_matches_employer` cleared ICE but
 * waved these through, and `pickSummary` only ever asked "does this read like an organisation?".
 */
describe("wikipedia entity match", () => {
  const summary = (title: string) => ({ type: "standard", title, description: "venture capital company", extract: `${title} is a company.` });

  it.each([
    ["Attio", "GV (company)"],
    ["Allye Energy", "List of Cadbury brands"],
    ["Freshminds", "Caroline Plumb"],
    ["Blenheim Chalcot", "Manoj Badale"],
    ["ICE", "U.S. Immigration and Customs Enforcement"],   // the initialism must spell the title out exactly
    // the same audit over all 173 wikipedia-sourced companies turned these up too — the LLM tier missed them as well
    ["Hymans Robertson", "Collective defined contribution"],
    ["Ameresco", "Energy service company"],
    ["Private Equity Insights", "Ardian (company)"],
    // rejecting Ardian let the candidate loop walk on to this one, which matched on the bare word "equity";
    // "equity" is a category word like "capital"/"partners", so it does not identify a firm either
    ["Private Equity Insights", "Vista Equity Partners"],
    // live re-check after the cleanup run: the next search hits, each sharing only a trailing or one-letter word.
    // The head of the name has to be what matches.
    ["Private Equity Insights", "Insight Partners"],
    ["Budweiser Brewing Group UK&I", "Genesee Brewing Company"],
    ["M Group Services", "M-Brain Group"],
    ["MI5, MI6 & GCHQ", "MI6"],                            // one of three agencies is not this employer
    ["J.P. Morgan", "J. P. Morgan"],                       // the banker, not the bank
    ["Codestone", "Tagetik"],
    ["Turner & Townsend Pty Limited", "International Institute for Conservation of Historic and Artistic Works"],
    ["Bakerhicks", "Morgan Sindall"],                      // the parent group's article is not this employer
  ])("rejects %s → %s", (name, title) => {
    expect(W.titleMatchesName(title, name)).toBe(false);
    expect(W.pickSummary(summary(title), name)).toBeNull();
  });

  it.each([
    ["EDF UK", "EDF Energy"],                              // shared token once "UK" is stripped
    ["EDF Energy", "EDF Energy"],
    ["AIG", "American International Group"],               // initialism spells the title
    ["EY", "Ernst & Young"],
    ["CIBC", "Canadian Imperial Bank of Commerce"],        // "of" does not count towards the initialism
    ["Charles River Associates", "CRA International"],     // initialism the other way round
    ["Monzo", "Monzo"],
    ["Jane Street", "Jane Street Capital"],
    ["Lovable", "Lovable (company)"],
    // real pairs the first cut of this guard wrongly rejected; each one is a rule below
    ["S&P Global", "S&P Global"],                          // "&" inside a word is part of the token
    ["P&G", "Procter & Gamble"],                           // ...but a free-standing one is a separator
    ["L'Oreal", "L'Oréal"],                                // accents folded
    ["Societe Generale", "Société Générale"],
    ["Citi", "Citigroup"],                                 // prefix
    ["Franklintempleton", "Franklin Templeton"],           // run-together name
    ["JPMorganChase", "JPMorgan Chase"],
    ["Lseg", "London Stock Exchange Group"],               // initialism that is not written in caps
    ["J.P. Morgan", "J.P. Morgan & Co."],
    // from the parallel Stage 7 audit of the same 435 facts
    ["NHS", "National Health Service"],
    ["RBC", "Royal Bank of Canada"],                       // "of" dropped from the initialism
    ["British Airways", "British Airways"],                // "British" is generic, so "Airways" is the head
  ])("keeps %s → %s", (name, title) => {
    expect(W.titleMatchesName(title, name)).toBe(true);
    expect(W.pickSummary(summary(title), name)).not.toBeNull();
  });

  it("does not match on a corporate word two unrelated names happen to share", () => {
    expect(W.titleMatchesName("Phenna Group", "Kisaco Group")).toBe(false);
    expect(W.titleMatchesName("Acme International Ltd", "Zeta International Ltd")).toBe(false);
  });

  it("still rejects an article that names the employer but is not about an organisation", () => {
    expect(W.pickSummary({ type: "standard", title: "Jane Street", description: "street in Manhattan, New York", extract: "Jane Street is a street in the West Village." }, "Jane Street")).toBeNull();
  });
});

describe("rank uses research", () => {
  it("sector weight and ai_forward now feed rank_score", async () => {
    const { rankAll } = await import("@/lib/pipeline/rank");
    const c = seedCompany();
    const job = getDb().insert(schema.jobs).values({ companyId: c.id, title: "Graduate Analyst", kind: "graduate_job", dedupeKey: "k1", isLondon: true, locationRaw: "London" }).returning().get();
    rankAll();
    const before = getDb().select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get()!.rankScore;
    R.writeGathered(c.id, await R.gather("Starling Bank", fetchers));
    const sources = R.sourcesFromDb(c.id);
    R.writeClassification(c.id, "Starling Bank", (await R.classify("Starling Bank", sources, { chain: fakeChain([{ ...GOOD, ai_forward: 3 }]) })).research!, sources);
    rankAll();
    const after = getDb().select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get()!;
    expect(after.rankScore).toBe(before + (SECTOR_WEIGHTS.fintech - 1) + 3 * 2);   // the fintech weight replaces the unknown default 1; ai_forward 3 → +6
    expect(after.rankBreakdown).toMatchObject({ sector_weight: SECTOR_WEIGHTS.fintech, ai_forward: 6 });
  });
});
