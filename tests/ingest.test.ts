/**
 * Orchestrator behaviour against a throwaway SQLite DB:
 *  - same scheme from two sources → one job, two job_sources
 *  - a failed source never deactivates its jobs; a successful one that stops listing a job does
 *  - touch records keep a job alive without a re-fetch
 *  - tracker rows (layer 3) survive a re-sweep untouched
 */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gradfinder-test-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.RAW_DIR = path.join(tmp, "raw");

// imports after env is set so the client opens the temp DB
const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
const { getDb, getSqlite, schema } = await import("@/lib/db/client");
const { runSweep } = await import("@/lib/pipeline/run");
type RawPosting = import("@/lib/pipeline/types").RawPosting;
type AdapterOutput = import("@/lib/pipeline/types").AdapterOutput;
type SourceAdapter = import("@/lib/pipeline/types").SourceAdapter;

const posting = (over: Partial<RawPosting>): RawPosting => ({
  source: "higherin", sourceId: "1", url: "https://x/1", title: "Graduate Programme 2027 - Technology", companyName: "Acme Ltd",
  locationRaw: "London", descriptionText: "blah", contentHash: "h1", ...over,
});
const adapter = (source: RawPosting["source"], out: AdapterOutput[] | Error): SourceAdapter => ({
  source, async run() { if (out instanceof Error) throw out; return out; },
});
const q = (sql: string) => getSqlite().prepare(sql).all() as Record<string, unknown>[];

beforeAll(() => { migrate(getDb(), { migrationsFolder: path.resolve("lib/db/migrations") }); });

describe("ingest", () => {
  it("collapses the same scheme from two sources into one job with two job_sources", async () => {
    await runSweep({ log: () => {}, adapters: [
      adapter("higherin", [posting({ source: "higherin", sourceId: "h1", url: "https://h/1" })]),
      adapter("linkedin", [posting({ source: "linkedin", sourceId: "l1", url: "https://l/1", companyName: "ACME", title: "Graduate Programme 2027 – Technology (London)", locationRaw: "London, England, UK" })]),
    ] });
    expect(q("select count(*) n from jobs")[0].n).toBe(1);
    expect(q("select count(*) n from job_sources")[0].n).toBe(2);
    expect(q("select count(*) n from companies")[0].n).toBe(1);
  });

  it("a failed source does not deactivate its jobs; a successful one that drops a job does", async () => {
    await runSweep({ log: () => {}, adapters: [adapter("higherin", new Error("boom")), adapter("linkedin", [posting({ source: "linkedin", sourceId: "l1", url: "https://l/1" })])] });
    expect(q("select is_active from jobs")[0].is_active).toBe(1);
    const r = await runSweep({ log: () => {}, adapters: [
      adapter("higherin", [posting({ source: "higherin", sourceId: "h2", url: "https://h/2", title: "Other Role" })]),
      adapter("linkedin", [posting({ source: "linkedin", sourceId: "l2", url: "https://l/2", title: "Other Role" })]),
    ] });
    expect(r.outcomes.every((o) => o.status === "ok")).toBe(true);
    expect(q("select is_active from jobs where title like 'Graduate Programme%'")[0].is_active).toBe(0);
    expect(q("select error from sweep_run_sources where status='failed'")[0].error).toMatch(/boom/);
  });

  it("a --limit run never deactivates anything — it only ever saw a slice", async () => {
    const active = () => q("select count(*) n from jobs where is_active=1")[0].n;
    const before = active();
    expect(before).toBeGreaterThan(0);
    // one source, one posting, limit set: without the guard every other job would go inactive
    const r = await runSweep({ log: () => {}, limit: 1, adapters: [adapter("higherin", [posting({ source: "higherin", sourceId: "h2", url: "https://h/2", title: "Other Role" })])] });
    expect(r.outcomes.every((o) => o.status === "ok")).toBe(true);
    expect(active()).toBe(before);
    expect(JSON.parse(q("select summary from sweep_runs order by id desc limit 1")[0].summary as string)).toMatchObject({ deactivated: 0 });
  });

  it("touch records keep a job alive without a re-fetch", async () => {
    await runSweep({ log: () => {}, adapters: [adapter("higherin", [{ source: "higherin", sourceId: "h2", url: "https://h/2", touchOnly: true }]), adapter("linkedin", [posting({ source: "linkedin", sourceId: "l2", url: "https://l/2", title: "Other Role" })])] });
    expect(q("select is_active from jobs where title='Other Role'")[0].is_active).toBe(1);
  });

  it("never touches tracker state", async () => {
    const job = q("select id from jobs where title='Other Role'")[0].id as number;
    getDb().insert(schema.applications).values({ jobId: job, status: "applied", notes: "sent CV" }).run();
    await runSweep({ log: () => {}, adapters: [adapter("higherin", [posting({ source: "higherin", sourceId: "h2", url: "https://h/2", title: "Other Role", contentHash: "changed" })])] });
    const app = q("select status, notes from applications")[0];
    expect(app).toEqual({ status: "applied", notes: "sent CV" });
  });

  it("a re-sweep keeps the LLM's not-entry-level verdict, including rows that predate the is_entry_level fact", async () => {
    const { refilter } = await import("@/lib/pipeline/refilter");
    // real case: 69 roles (Wayve DevOps Engineer, ...) were extracted before Stage 4 wrote is_entry_level facts,
    // so their verdict lived only in excluded_reason; the first refilter wiped it and they reappeared
    await runSweep({ log: () => {}, adapters: [adapter("higherin", [posting({ source: "higherin", sourceId: "s1", url: "https://h/s1", title: "DevOps Engineer 2027" })])] });
    const id = q("select id from jobs where title='DevOps Engineer 2027'")[0].id as number;
    getSqlite().prepare("update jobs set excluded_reason='not_entry_level:description' where id=?").run(id);
    await runSweep({ log: () => {}, adapters: [adapter("higherin", [posting({ source: "higherin", sourceId: "s1", url: "https://h/s1", title: "DevOps Engineer 2027", contentHash: "v2" })])] });
    expect(q(`select excluded_reason from jobs where id=${id}`)[0].excluded_reason).toBe("not_entry_level:description");
    // a fact from a later extraction overrides the stored verdict either way
    getDb().insert(schema.facts).values({ entityType: "job", entityId: id, field: "is_entry_level", valueText: "true", valueJson: { value: true }, sourceUrl: "https://h/s1", sourceKind: "posting", confidence: "high" }).run();
    refilter([id]);
    expect(q(`select excluded_reason from jobs where id=${id}`)[0].excluded_reason).toBeNull();
  });
});

describe("content hash and posted date", () => {
  const job = (title: string) => q(`select content_hash h, posted_at p, first_seen f from jobs where title = '${title}'`)[0];
  it("hashes title + description, not the fetched HTML; a real edit changes it; posted_at is stored and first_seen kept", async () => {
    const mk = (over: Partial<RawPosting>) => posting({ source: "higherin", sourceId: "ph1", url: "https://h/ph1", title: "Hash Check Graduate 2027", companyName: "Hashco", ...over });
    await runSweep({ log: () => {}, adapters: [adapter("higherin", [mk({ contentHash: "html-1", descriptionText: "Build  tools.\nIn London.", datePosted: "2026-10-01T09:00:00Z" })])] });
    const first = job("Hash Check Graduate 2027");
    expect(first.p).toBe("2026-10-01");
    await runSweep({ log: () => {}, adapters: [adapter("higherin", [mk({ contentHash: "html-2", descriptionText: "Build tools. In London.", datePosted: "not a date" })])] });
    const again = job("Hash Check Graduate 2027");
    expect(again.h).toBe(first.h);          // only the HTML noise and whitespace differ
    expect(again.p).toBe("2026-10-01");     // a bad date leaves the stored one alone
    expect(again.f).toBe(first.f);
    await runSweep({ log: () => {}, adapters: [adapter("higherin", [mk({ contentHash: "html-3", descriptionText: "Build tools. In Leeds." })])] });
    expect(job("Hash Check Graduate 2027").h).not.toBe(first.h);
  });
});
