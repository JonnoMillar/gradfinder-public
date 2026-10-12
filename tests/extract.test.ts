/**
 * Extraction step against a throwaway DB with a fake LLM provider:
 *  - schema tolerates the sloppy shapes small models produce ("yes"/"not stated"/null arrays)
 *  - only kept, active, un-extracted jobs are processed; a second run is a no-op
 *  - extracted fields land on jobs.*, as posting facts with the canonical URL, and in extraction_meta
 *  - function/is_entry_level feed excluded_reason; employer_name re-homes reposter jobs
 *  - a garbage response → "unknown" fields, provider "none", and the job is retried next run
 *  - the source-derived register_interest kind is never overwritten
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gradfinder-extract-"));
process.env.DB_PATH = path.join(tmp, "test.db");

const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
const { getDb, getSqlite, schema } = await import("@/lib/db/client");
const { ExtractionSchema, runExtract, buildPrompt } = await import("@/lib/pipeline/extract");
type Chain = import("@/lib/llm").Chain;

const good = {
  kind: "graduate_scheme", function: "data", is_entry_level: true, employer_name: null,
  eligibility: { degree_class: "2:1", subjects: [], visa_sponsorship: false, other: ["right to work in the UK"] },
  application_requirements: { cv: true, cover_letter: false, motivational_questions: true, video_interview: true, online_tests: true, assessment_centre: true, other: [] },
  process_stages: ["online application", "numerical test", "video interview", "assessment centre"],
  salary_text: "£35,000", start_text: "September 2027", deadline_text: null,
  evidence: { eligibility: "minimum 2:1 in any discipline", process_stages: "assessment centre" },
};

/** Fake provider: returns each canned reply in turn (string = raw text, object = JSON). */
function fakeChain(replies: (object | string)[]): Chain & { calls: number } {
  const c = { calls: 0, cooldownUntil: new Map<string, number>(), providers: [{ name: "fake", models: ["m"], chat: async () => {
    c.calls++;
    const r = replies[Math.min(c.calls - 1, replies.length - 1)];
    return typeof r === "string" ? r : JSON.stringify(r);
  } }] };
  return c;
}

const q = (sql: string, ...args: unknown[]) => getSqlite().prepare(sql).all(...args) as Record<string, any>[];
let seq = 0;
function seedJob(over: Partial<typeof schema.jobs.$inferInsert> & { company?: string } = {}) {
  const db = getDb();
  const name = over.company ?? "Acme";
  const slug = name.toLowerCase();
  const company = db.select().from(schema.companies).where(eq(schema.companies.slug, slug)).get()
    ?? db.insert(schema.companies).values({ slug, name }).returning().get();
  const { company: _c, ...rest } = over;
  return db.insert(schema.jobs).values({
    companyId: company.id, title: "Graduate Data Analyst 2027", locationRaw: "London", isLondon: true,
    descriptionText: "We want a minimum 2:1 in any discipline. Send a CV and answer three motivational questions. Stages: online application, numerical test, video interview, assessment centre. We cannot sponsor visas. Salary £35,000. Start September 2027.",
    canonicalUrl: `https://x/${++seq}`, dedupeKey: `k${seq}`, contentHash: `h${seq}`, ...rest,
  }).returning().get();
}
const { eq } = await import("drizzle-orm");

beforeAll(() => migrate(getDb(), { migrationsFolder: path.resolve("lib/db/migrations") }));
beforeEach(() => { getSqlite().exec("delete from facts; delete from jobs; delete from companies;"); });

describe("ExtractionSchema", () => {
  it("coerces sloppy tri-states and null arrays", () => {
    const r = ExtractionSchema.parse({
      ...good,
      is_entry_level: "yes",
      eligibility: { degree_class: null, subjects: null, visa_sponsorship: "not stated", other: null },
      application_requirements: { ...good.application_requirements, cv: "true", cover_letter: "no", online_tests: null, other: null },
      process_stages: null, evidence: null,
    });
    expect(r.is_entry_level).toBe(true);
    expect(r.eligibility).toEqual({ degree_class: null, subjects: [], visa_sponsorship: "unknown", other: [] });
    expect(r.application_requirements.cv).toBe(true);
    expect(r.application_requirements.cover_letter).toBe(false);
    expect(r.application_requirements.online_tests).toBe("unknown");
    expect(r.process_stages).toEqual([]);
    expect(r.evidence).toEqual({});
  });
  it("rejects a kind or function outside the taxonomy", () => {
    expect(ExtractionSchema.safeParse({ ...good, kind: "job" }).success).toBe(false);
    expect(ExtractionSchema.safeParse({ ...good, function: "wizardry" }).success).toBe(false);
  });
});

describe("runExtract", () => {
  it("writes fields, posting facts and extraction_meta, and skips the job on the next run", async () => {
    const job = seedJob();
    const chain = fakeChain([good]);
    const r1 = await runExtract({ chain, log: () => {} });
    expect(r1).toMatchObject({ processed: 1, extracted: 1, unknown: 0 });

    const row = getDb().select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get()!;
    expect(row.kind).toBe("graduate_scheme");
    expect(row.function).toBe("data");
    expect(row.eligibility).toEqual(good.eligibility);
    expect(row.applicationRequirements).toEqual(good.application_requirements);
    expect(row.processStages).toEqual(good.process_stages);
    expect(row.salaryText).toBe("£35,000");
    expect(row.startText).toBe("September 2027");
    expect(row.excludedReason).toBeNull();
    expect(row.extractionMeta).toMatchObject({ provider: "fake", model: "m", content_hash: job.contentHash });
    expect(row.extractionMeta?.prompt_hash).toMatch(/^[0-9a-f]{12,}$/);

    const facts = q("select field, value_text, value_json, source_url, source_kind, confidence from facts where entity_type='job' and entity_id=? order by field", job.id);
    expect(facts.map((f) => f.field)).toEqual(["application_requirements", "eligibility", "is_entry_level", "process_stages", "salary_text", "start_text"]);
    for (const f of facts) { expect(f.source_url).toBe(job.canonicalUrl); expect(f.source_kind).toBe("posting"); expect(f.confidence).toBe("high"); }
    expect(JSON.parse(facts.find((f) => f.field === "eligibility")!.value_json).evidence).toBe("minimum 2:1 in any discipline");

    const r2 = await runExtract({ chain, log: () => {} });
    expect(r2).toMatchObject({ processed: 0, skipped: 1 });
    expect(chain.calls).toBe(1);
  });

  it("re-extracts when the content hash changes, and with --force", async () => {
    const job = seedJob();
    const chain = fakeChain([good]);
    await runExtract({ chain, log: () => {} });
    getDb().update(schema.jobs).set({ contentHash: "changed" }).where(eq(schema.jobs.id, job.id)).run();
    await runExtract({ chain, log: () => {} });
    expect(chain.calls).toBe(2);
    await runExtract({ chain, force: true, log: () => {} });
    expect(chain.calls).toBe(3);
  });

  it("does not touch excluded or inactive jobs", async () => {
    seedJob({ excludedReason: "not_london" });
    seedJob({ isActive: false });
    const chain = fakeChain([good]);
    const r = await runExtract({ chain, log: () => {} });
    expect(r.processed).toBe(0);
    expect(chain.calls).toBe(0);
  });

  it("excludes on an excluded function and on is_entry_level=false", async () => {
    const a = seedJob({ title: "Graduate Programme 2027" });
    const b = seedJob({ title: "Graduate Programme 2027" });
    const chain = fakeChain([{ ...good, function: "sales" }, { ...good, is_entry_level: false }]);
    const r = await runExtract({ chain, log: () => {} });
    expect(r.excludedNow).toBe(2);
    expect(q("select excluded_reason r from jobs where id=?", a.id)[0].r).toBe("excluded_function:sales");
    expect(q("select excluded_reason r from jobs where id=?", b.id)[0].r).toBe("not_entry_level:description");
  });

  it("re-homes a reposter's job under the employer the posting names", async () => {
    const job = seedJob({ company: "targetjobs UK" });
    await runExtract({ chain: fakeChain([{ ...good, employer_name: "Deutsche Bank AG" }]), log: () => {} });
    const row = q("select c.name, c.slug from jobs j join companies c on c.id=j.company_id where j.id=?", job.id)[0];
    expect(row.slug).toBe("deutsche-bank");
    expect(row.name).toBe("Deutsche Bank AG");
    expect(q("select value_text v from facts where entity_type='job' and entity_id=? and field='employer_name'", job.id)[0].v).toBe("Deutsche Bank AG");
  });

  it("does not re-home a job whose company is a real employer", async () => {
    const job = seedJob({ company: "Monzo" });
    await runExtract({ chain: fakeChain([{ ...good, employer_name: "Monzo Bank Ltd" }]), log: () => {} });
    expect(q("select c.slug from jobs j join companies c on c.id=j.company_id where j.id=?", job.id)[0].slug).toBe("monzo");
  });

  it("records a garbage response as unknown and retries it next run", async () => {
    const job = seedJob();
    const chain = fakeChain(["I am a teapot"]);
    const r1 = await runExtract({ chain, log: () => {} });
    expect(r1).toMatchObject({ processed: 1, extracted: 0, unknown: 1 });
    const row = getDb().select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get()!;
    expect(row.kind).toBe("unknown");
    expect(row.function).toBeNull();
    expect(row.eligibility).toEqual({ degree_class: null, subjects: [], visa_sponsorship: "unknown", other: [] });
    expect(row.applicationRequirements?.cv).toBe("unknown");
    expect(row.processStages).toEqual([]);
    expect(row.extractionMeta).toMatchObject({ provider: "none", model: "none", content_hash: job.contentHash });
    expect(q("select count(*) n from facts where entity_id=?", job.id)[0].n).toBe(0);
    expect(row.excludedReason).toBeNull();

    const r2 = await runExtract({ chain, log: () => {} });
    expect(r2.processed).toBe(1);
    expect(chain.calls).toBe(4); // 2 attempts (first + repair) per run
  });

  it("keeps a source-derived register_interest kind and fills unknown kind from the LLM", async () => {
    const ri = seedJob({ kind: "register_interest" });
    const un = seedJob({ kind: "unknown" });
    await runExtract({ chain: fakeChain([{ ...good, kind: "graduate_scheme" }]), log: () => {} });
    expect(q("select kind from jobs where id=?", ri.id)[0].kind).toBe("register_interest");
    expect(q("select kind from jobs where id=?", un.id)[0].kind).toBe("graduate_scheme");
  });

  it("prefers the source's structured salary/start/deadline text over the LLM's", async () => {
    const job = seedJob({ salaryText: "£40k + bonus", deadlineText: "31 Oct 2026" });
    await runExtract({ chain: fakeChain([{ ...good, deadline_text: "October" }]), log: () => {} });
    const row = getDb().select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get()!;
    expect(row.salaryText).toBe("£40k + bonus");
    expect(row.deadlineText).toBe("31 Oct 2026");
    expect(row.startText).toBe("September 2027");
  });

  it("honours --limit and --ids", async () => {
    const a = seedJob(); seedJob(); const c = seedJob();
    const chain = fakeChain([good]);
    expect((await runExtract({ chain, limit: 2, log: () => {} })).processed).toBe(2);
    expect((await runExtract({ chain, jobIds: [c.id], force: true, log: () => {} })).processed).toBe(1);
    expect(q("select count(*) n from jobs where extraction_meta is not null")[0].n).toBe(3);
    expect(a.id).toBeLessThan(c.id);
  });
});

describe("buildPrompt", () => {
  it("sends only the posting text, capped, never the CV or company research", () => {
    const { system, user } = buildPrompt({ title: "T", companyName: "C", descriptionText: "x".repeat(20_000) });
    expect(user.length).toBeLessThan(13_000);
    expect(user).toContain("T");
    expect(system).toMatch(/only.*posting/i);
  });
});

describe("rankAll", () => {
  it("writes rank_score and rank_breakdown for every active job", async () => {
    const { rankAll } = await import("@/lib/pipeline/rank");
    const a = seedJob({ kind: "graduate_scheme" });
    const b = seedJob({ kind: "insight", isActive: false });
    const n = rankAll(new Date("2026-09-20T12:00:00Z"));
    expect(n).toBe(1);
    const ra = q("select rank_score s, rank_breakdown b from jobs where id=?", a.id)[0];
    expect(ra.s).toBe(-97); // not evaluated −100 + sector unknown 1 + scheme 2
    expect(JSON.parse(ra.b)).toMatchObject({ not_evaluated: -100, kind_bonus: 2, sector_weight: 1 });
    expect(q("select rank_score s from jobs where id=?", b.id)[0].s).toBe(0);
  });
});

describe("quoteInText", () => {
  it("matches verbatim quotes ignoring case, whitespace runs and curly quotes", async () => {
    const { quoteInText } = await import("@/lib/pipeline/extract");
    const text = "You’ll need a minimum   2:1 in any\n discipline. Stages: online test, assessment centre.";
    expect(quoteInText("minimum 2:1 in any discipline", text)).toBe(true);
    expect(quoteInText("You'll need a Minimum 2:1", text)).toBe(true);
    expect(quoteInText("a first class degree", text)).toBe(false);
    expect(quoteInText("", text)).toBe(false);
  });
});

describe("degree_class normalisation", () => {
  it("maps the usual spellings to 1st / 2:1 / 2:2 and non-answers to null", () => {
    const dc = (v: unknown) => ExtractionSchema.parse({ ...good, eligibility: { ...good.eligibility, degree_class: v } }).eligibility.degree_class;
    expect(dc("2.1")).toBe("2:1"); expect(dc("2:1")).toBe("2:1"); expect(dc("Upper second class")).toBe("2:1"); expect(dc("2.1 or above")).toBe("2:1");
    expect(dc("2.2")).toBe("2:2"); expect(dc("2:2 or above")).toBe("2:2");
    expect(dc("1st")).toBe("1st"); expect(dc("First")).toBe("1st"); expect(dc("first class honours")).toBe("1st");
    expect(dc("unknown")).toBeNull(); expect(dc("not stated")).toBeNull(); expect(dc("any")).toBeNull(); expect(dc(null)).toBeNull();
    expect(dc("Bachelor's degree")).toBe("Bachelor's degree"); // unrecognised but real text is kept
  });
});

describe("evidence verification", () => {
  it("stores verified=true when the quote is in the posting and false when it is not", async () => {
    const job = seedJob();
    await runExtract({ chain: fakeChain([{ ...good, evidence: { eligibility: "minimum 2:1 in any discipline", process_stages: "made up quote" } }]), log: () => {} });
    const v = (field: string) => JSON.parse(q("select value_json v from facts where entity_id=? and field=?", job.id, field)[0].v);
    expect(v("eligibility")).toMatchObject({ evidence: "minimum 2:1 in any discipline", verified: true });
    expect(v("process_stages")).toMatchObject({ evidence: "made up quote", verified: false });
    expect(v("application_requirements")).toMatchObject({ evidence: null, verified: false });
  });
});

describe("groundExtraction", () => {
  it("downgrades claims the posting text cannot support, and leaves supported ones alone", async () => {
    const { groundExtraction } = await import("@/lib/pipeline/extract");
    const parsed = ExtractionSchema.parse({ ...good,
      eligibility: { degree_class: "2:1", subjects: ["Economics"], visa_sponsorship: false, other: [] },
      application_requirements: { cv: true, cover_letter: true, motivational_questions: true, video_interview: true, online_tests: true, assessment_centre: true, other: [] },
    });
    const posting = "Send us your CV. There is an online numerical test then an assessment centre. We cannot sponsor visas.";
    const g = groundExtraction(parsed, posting);
    expect(g.data.eligibility.degree_class).toBeNull();            // no 2:1 anywhere in the text
    expect(g.data.eligibility.subjects).toEqual([]);               // Economics never mentioned
    expect(g.data.eligibility.visa_sponsorship).toBe(false);       // "sponsor" is there
    expect(g.data.application_requirements).toMatchObject({ cv: true, online_tests: true, assessment_centre: true, cover_letter: "unknown", motivational_questions: "unknown", video_interview: "unknown" });
    expect(g.dropped.sort()).toEqual(["application_requirements.cover_letter", "application_requirements.motivational_questions", "application_requirements.video_interview", "eligibility.degree_class", "eligibility.subjects"].sort());
  });
  it("accepts the common spellings", async () => {
    const { groundExtraction } = await import("@/lib/pipeline/extract");
    const parsed = ExtractionSchema.parse({ ...good, eligibility: { ...good.eligibility, degree_class: "2:1", subjects: ["Computer Science"] } });
    const g = groundExtraction(parsed, "A 2.1 or above in computer science; send a CV, sit online tests and a video interview, answer motivational questions, then an assessment centre. We do not sponsor visas.");
    expect(g.data.eligibility.degree_class).toBe("2:1");
    expect(g.data.eligibility.subjects).toEqual(["Computer Science"]);
    expect(g.data.application_requirements.cover_letter).toBe(false); // false claims are never touched
    expect(g.dropped).toEqual([]);
  });
  it("is applied by runExtract before anything is written", async () => {
    const job = seedJob({ descriptionText: "Just apply online. No requirements listed." });
    await runExtract({ chain: fakeChain([{ ...good, eligibility: { ...good.eligibility, degree_class: "1st" } }]), log: () => {} });
    const row = getDb().select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get()!;
    expect(row.eligibility?.degree_class).toBeNull();
    expect(row.applicationRequirements?.cv).toBe("unknown");
    expect(row.applicationRequirements?.assessment_centre).toBe("unknown");
  });
});

describe("concurrency", () => {
  it("processes jobs in parallel workers and still writes every row exactly once", async () => {
    const ids = [seedJob(), seedJob(), seedJob(), seedJob(), seedJob()].map((j) => j.id);
    let inFlight = 0, peak = 0;
    const chain: Chain = { cooldownUntil: new Map(), providers: [{ name: "slow", models: ["m"], chat: async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 30));
      inFlight--;
      return JSON.stringify(good);
    } }] };
    const r = await runExtract({ chain, concurrency: 3, log: () => {} });
    expect(r).toMatchObject({ processed: 5, extracted: 5 });
    expect(peak).toBe(3);
    expect(q(`select count(*) n from jobs where extraction_meta is not null and id in (${ids.join(",")})`)[0].n).toBe(5);
    expect(q("select count(*) n from facts where field='eligibility'")[0].n).toBe(5);
  });
});

// Stage 4 task 0 audit: 13/232 rows copied the interview stages into application_requirements.other and ~20
// stored "how to apply" instructions there ("please apply through our careers portal", "Drop us your application").
describe("groundExtraction: application_requirements.other", () => {
  it("drops entries that duplicate a process stage or are apply-instructions, keeps real materials", async () => {
    const { groundExtraction } = await import("@/lib/pipeline/extract");
    const parsed = ExtractionSchema.parse({ ...good,
      process_stages: ["Initial Call", "Take home task", "Final interview"],
      application_requirements: { ...good.application_requirements, other: [
        "initial call", "Take home task", "portfolio", "Please submit your application in English", "please apply through our careers portal",
        "Drop us your application", "click 'Apply'", "two references", "Send us two pieces of work",
      ] },
    });
    const g = groundExtraction(parsed, "Send a CV, portfolio and two references. Stages: initial call, take home task, final interview.");
    expect(g.data.application_requirements.other).toEqual(["portfolio", "two references", "Send us two pieces of work"]);
    expect(g.dropped).toContain("application_requirements.other");
  });
});

// The model's is_entry_level verdict used to be lost unless it caused an exclusion, so the audit could not tell
// "true" from "unknown" on kept rows. It is now a posting fact like the others.
describe("is_entry_level fact", () => {
  it("stores the verdict with its evidence quote", async () => {
    const job = seedJob({ descriptionText: "Open to final-year students; no prior experience needed. Send a CV." });
    await runExtract({ chain: fakeChain([{ ...good, evidence: { is_entry_level: "no prior experience needed" } }]), log: () => {} });
    const rows = q("select value_text t, value_json v from facts where entity_id=? and field='is_entry_level'", job.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].t).toBe("true");
    expect(JSON.parse(rows[0].v)).toMatchObject({ value: true, evidence: "no prior experience needed", verified: true });
  });
  it("is stored as 'unknown' too, so a silent non-answer is visible", async () => {
    const job = seedJob();
    await runExtract({ chain: fakeChain([{ ...good, is_entry_level: "unknown" }]), log: () => {} });
    expect(q("select value_text t from facts where entity_id=? and field='is_entry_level'", job.id)[0].t).toBe("unknown");
  });
});
