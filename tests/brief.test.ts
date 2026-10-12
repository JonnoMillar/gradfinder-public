/** The research brief only states what the DB holds, with sources, and never passes stored news off as grounding. */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gradfinder-brief-"));
process.env.DB_PATH = path.join(tmp, "test.db");

const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
const { getDb, getSqlite } = await import("@/lib/db/client");
const { buildBrief } = await import("@/lib/apply/brief");

let jobId = 0;
beforeAll(() => {
  migrate(getDb(), { migrationsFolder: path.resolve("lib/db/migrations") });
  const db = getSqlite();
  const c = Number(db.prepare("insert into companies (slug, name, summary) values ('contoso','Contoso','A consultancy.')").run().lastInsertRowid);
  jobId = Number(db.prepare(`insert into jobs (company_id, title, dedupe_key, salary_text, eligibility)
    values (?, 'Graduate Consultant', 'n1', '£48,000 + £2,500 joining bonus', '{"degree_class":null,"subjects":["Any degree"],"visa_sponsorship":"unknown","other":["136 UCAS Points"]}')`).run(c).lastInsertRowid);
  db.prepare("insert into job_sources (job_id, source, source_id, url) values (?, 'higherin', 'x', 'https://board/contoso')").run(jobId);
  db.prepare(`insert into facts (entity_type, entity_id, field, value_text, source_url, source_kind, confidence)
    values ('company', ?, 'process', 'Only one application allowed per recruiting season', 'https://contoso.tal.net/x', 'search_snippet', 'low')`).run(c);
  db.prepare("insert into news_items (company_id, title, url) values (?, 'Wanted appeal: Lee Contoso', 'https://news/1')").run(c);
});

describe("buildBrief", () => {
  it("states the posting's facts with the posting URL, and company facts with theirs", () => {
    const md = buildBrief(jobId, "2026-09-23")!.markdown;
    expect(md).toContain("£48,000 + £2,500 joining bonus");
    expect(md).toContain("136 UCAS Points");
    expect(md).toContain("source: https://board/contoso");
    expect(md).toContain("Only one application allowed per recruiting season (search_snippet, low; https://contoso.tal.net/x)");
  });
  it("never includes stored headlines, which are matched by name only", () => {
    const md = buildBrief(jobId, "2026-09-23")!.markdown;
    expect(md).not.toContain("Lee Contoso");
    expect(md).toContain("Not included");
  });
  it("names the file by company and job id, and returns null for an unknown job", () => {
    expect(buildBrief(jobId)!.fileName).toBe(`contoso-${jobId}.md`);
    expect(buildBrief(999999)).toBeNull();
  });
});
