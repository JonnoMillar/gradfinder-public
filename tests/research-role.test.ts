/**
 * Deep research importer: strict validation, every section covered or honestly unknown, idempotent replace that
 * leaves other roles' company research alone, and TfL commute parsing.
 */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gradfinder-research-role-"));
process.env.DB_PATH = path.join(tmp, "test.db");

const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
const { getDb, getSqlite } = await import("@/lib/db/client");
const { saveResearch, saveValues, saveCommutes, officeFor, quickest, nextMondayMorning, researchQueue, SECTIONS } = await import("@/lib/apply/research");

const db = () => getSqlite();
let a = 0, b = 0, co = 0;

const claim = (section: string, over: Record<string, unknown> = {}) => ({
  section, about: "job", key: "main", text: `A claim about ${section}`, quote: null,
  sourceUrl: "https://example.com/careers", sourceKind: "company_site", confidence: "high", ...over,
});
const research = (jobId: number, over: Record<string, unknown> = {}) => ({
  jobId,
  claims: [
    ...SECTIONS.filter((s) => s !== "news" && s !== "culture").map((s) => claim(s)),
    claim("company", { about: "company", key: "values" }),
    claim("office", { key: "address", text: "1 Example St, London EC2R 8AH", value: "EC2R 8AH" }),
  ],
  unknowns: [{ section: "news", searched: "newsroom and Google News, last 6 months" }, { section: "culture", searched: "Glassdoor, careers FAQ" }],
  fit: [{ requirement: "2:1 degree", status: "unconfirmed", evidence: "Predicted 2:1 is still a placeholder on the CV" }],
  angle: { stories: [{ story: "1. Automating the weekly forecast", why: "Data tooling" }], hook: "Built forecasting tools with AI on a placement", openQuestions: [] },
  ...over,
});
const drFacts = (type: string, id: number) =>
  (db().prepare("select field from facts where entity_type=? and entity_id=? and field like 'dr.%' order by field").all(type, id) as { field: string }[]).map((r) => r.field);

beforeAll(() => {
  migrate(getDb(), { migrationsFolder: path.resolve("lib/db/migrations") });
  co = Number(db().prepare("insert into companies (slug, name) values ('acme','Acme')").run().lastInsertRowid);
  const job = (key: string) => Number(db().prepare("insert into jobs (company_id, title, dedupe_key) values (?,?,?)").run(co, "Graduate", key).lastInsertRowid);
  a = job("a"); b = job("b");
  // a non-research company fact that must survive every import
  db().prepare("insert into facts (entity_type, entity_id, field, value_text, source_url, source_kind, confidence) values ('company',?,'what_they_do','Makes things','https://en.wikipedia.org/wiki/Acme','wikipedia','high')").run(co);
});

describe("saveResearch", () => {
  it("rejects a section with neither a claim nor an unknowns entry", () => {
    expect(() => saveResearch(research(a, { unknowns: [{ section: "news", searched: "newsroom and Google News" }] }), "m")).toThrow(/culture/);
  });
  it("rejects unsourced, wikipedia-sourced, undated-news and extra-field claims", () => {
    const bad = (c: Record<string, unknown>) => research(a, { claims: [...research(a).claims, c] });
    expect(() => saveResearch(bad(claim("pay", { sourceUrl: "not a url" })), "m")).toThrow();
    expect(() => saveResearch(bad(claim("pay", { sourceUrl: "ftp://x.com/a" })), "m")).toThrow();
    expect(() => saveResearch(bad(claim("company", { sourceKind: "wikipedia" })), "m")).toThrow();
    expect(() => saveResearch(bad(claim("news", { sourceKind: "news" })), "m")).toThrow(/publishedAt/);
    expect(() => saveResearch(bad(claim("pay", { invented: true })), "m")).toThrow();
    expect(() => saveResearch(research(99999), "m")).toThrow(/does not exist/);
  });
  it("stores claims as sourced facts and the judgement in role_research", () => {
    expect(saveResearch(research(a), "m")).toEqual({ jobId: a, claims: 9, result: "inserted" });
    expect(drFacts("job", a)).toContain("dr.office.address");
    expect(drFacts("company", co)).toEqual(["dr.company.values"]);
    const row = db().prepare("select unknowns, fit, angle from role_research where job_id=?").get(a) as Record<string, string>;
    expect(JSON.parse(row.unknowns)).toHaveLength(2);
    expect(JSON.parse(row.fit)[0].status).toBe("unconfirmed");
  });
  it("replaces on re-import without duplicating, and keeps non-research facts", () => {
    expect(saveResearch(research(a), "m").result).toBe("replaced");
    expect(drFacts("job", a).length).toBe(8);
    expect(db().prepare("select count(*) n from role_research").get()).toEqual({ n: 1 });
    expect(db().prepare("select count(*) n from facts where field='what_they_do'").get()).toEqual({ n: 1 });
  });
  it("a second role with only job claims leaves the company research alone", () => {
    const jobOnly = research(b);
    jobOnly.claims = jobOnly.claims.filter((c) => c.about === "job");
    jobOnly.unknowns = [...jobOnly.unknowns, { section: "company", searched: "covered by the other role's research" }];
    saveResearch(jobOnly, "m");
    expect(drFacts("company", co)).toEqual(["dr.company.values"]);
    expect(drFacts("job", a).length).toBe(8);
  });
});

describe("saveValues", () => {
  const value = (key: string, over: Record<string, unknown> = {}) => ({
    key, label: `Being ${key}`, quote: "We are one team.", sourceUrl: "https://example.com/careers", sourceKind: "company_site",
    confidence: "high", ...over,
  });
  const vals = ["clients", "team", "ownership"].map((k) => value(k));
  it("needs 3 to 5 sourced values with unique keys, and a real company", () => {
    expect(() => saveValues({ company: "acme", values: vals.slice(0, 2) })).toThrow();
    expect(() => saveValues({ company: "acme", values: [...vals, value("team")] })).toThrow(/duplicate/);
    expect(() => saveValues({ company: "acme", values: [...vals.slice(0, 2), value("x", { sourceUrl: "nope" })] })).toThrow();
    expect(() => saveValues({ company: "nobody", values: vals })).toThrow(/does not exist/);
  });
  it("stores company facts, replaces them on re-import, and survives a deep research re-import", () => {
    expect(saveValues({ company: "acme", values: [...vals, value("future", { story: "Quarter ends with Harry" })] })).toEqual({ company: "acme", values: 4 });
    saveValues({ company: "acme", values: vals });
    expect(drFacts("company", co).filter((f) => f.startsWith("dr.values."))).toEqual(["dr.values.clients", "dr.values.ownership", "dr.values.team"]);
    saveResearch(research(a), "m");
    expect(drFacts("company", co)).toEqual(["dr.company.values", "dr.values.clients", "dr.values.ownership", "dr.values.team"]);
  });
});

describe("career path (Claude's rough estimate)", () => {
  const step = (title: string, low: number, high: number) => ({ title, years: "2–4", payLow: low, payHigh: high });
  const path = { start: { ...step("Graduate Analyst", 45, 50), years: "0–2" }, basis: "Posting pay plus general London market knowledge",
    tracks: [{ name: "Credit", why: "Stays close to the data", steps: [step("Senior Analyst", 60, 75)] },
      { name: "Data science", why: "Leans into modelling", steps: [step("Data Scientist", 60, 85)] }] };
  it("stores a valid path and rejects an inverted pay range or a single track", () => {
    saveResearch(research(a, { careerPath: path }), "m");
    const row = db().prepare("select career_path from role_research where job_id=?").get(a) as { career_path: string };
    expect(JSON.parse(row.career_path).tracks).toHaveLength(2);
    expect(() => saveResearch(research(a, { careerPath: { ...path, start: step("Grad", 50, 40) } }), "m")).toThrow(/payHigh/);
    expect(() => saveResearch(research(a, { careerPath: { ...path, tracks: path.tracks.slice(0, 1) } }), "m")).toThrow();
  });
});

describe("researchQueue", () => {
  it("lists the top-N unresearched kept roles plus tracked ones, soonest deadline first", () => {
    const job = (key: string, rank: number, deadline: string | null, excluded: string | null = null) =>
      Number(db().prepare("insert into jobs (company_id, title, dedupe_key, rank_score, deadline, excluded_reason) values (?,?,?,?,?,?)")
        .run(co, `Role ${key}`, `q-${key}`, rank, deadline, excluded).lastInsertRowid);
    const high = job("high", 90, null), soon = job("soon", 80, "2026-10-01"), low = job("low", 1, null);
    job("gone", 95, null, "closed:page says expired");
    db().prepare("insert into applications (job_id, status) values (?, 'interested')").run(low);
    const q = researchQueue(2);
    expect(q.map((r) => r.jobId)).toEqual([soon, high, low]);   // researched (a, b) and excluded roles never appear
    expect(q.find((r) => r.jobId === low)?.why).toBe("tracked");
  });
});

describe("commute", () => {
  it("finds the office postcode on the job's research", () => {
    expect(officeFor(a)).toEqual({ postcode: "EC2R 8AH", address: "1 Example St, London EC2R 8AH" });
  });
  it("picks the quickest TfL journey and names its legs", () => {
    const body = { journeys: [
      { duration: 41, legs: [{ mode: { name: "tube" }, instruction: { summary: "District line to Embankment" } }] },
      { duration: 36, legs: [{ mode: { name: "national-rail" }, instruction: { summary: "SWR to Waterloo" } }, { mode: { name: "walking" }, instruction: { summary: "Walk to EC2R 8AH" } }] },
    ] };
    expect(quickest(body)).toEqual({ minutes: 36, summary: "national-rail: SWR to Waterloo · walking: Walk to EC2R 8AH" });
    expect(quickest({ journeys: [] })).toBeNull();
  });
  it("departs next Monday, never today", () => {
    expect(nextMondayMorning(new Date("2026-09-25T12:00:00Z"))).toBe("20260928"); // Friday → Monday
    expect(nextMondayMorning(new Date("2026-09-28T12:00:00Z"))).toBe("20261005"); // Monday → next Monday
  });
  it("stores one sourced fact per station and fails loudly when TfL finds nothing", async () => {
    const ok = (async () => new Response(JSON.stringify({ journeys: [{ duration: 30, legs: [{ mode: { name: "tube" }, instruction: { summary: "Northern line to Bank" } }] }] }))) as typeof fetch;
    const stations = [{ name: "Brixton", stop: "940GZZLUBXN" }, { name: "Stratford", stop: "940GZZLUSTD" }];
    const got = await saveCommutes(a, ok, new Date("2026-09-25T12:00:00Z"), stations);
    expect(got.map((c) => c.minutes)).toEqual([30, 30]);
    const rows = db().prepare("select field, source_url, source_kind from facts where field like 'dr.commute.%' and entity_id=?").all(a) as Record<string, string>[];
    expect(rows.map((r) => r.field).sort()).toEqual(["dr.commute.brixton", "dr.commute.stratford"]);
    expect(rows[0].source_url).toMatch(/^https:\/\/api\.tfl\.gov\.uk\/Journey\/JourneyResults\/.*date=20260928/);
    const empty = (async () => new Response(JSON.stringify({ journeys: [] }))) as typeof fetch;
    await expect(saveCommutes(a, empty, new Date(), stations)).rejects.toThrow(/no journey/);
    expect(db().prepare("select count(*) n from facts where field like 'dr.commute.%'").get()).toEqual({ n: 2 });
  });
});
