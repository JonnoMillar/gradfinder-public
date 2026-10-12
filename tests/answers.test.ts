/** Draft → approved → submitted: drafting runs can never overwrite what Jonno approved. */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gradfinder-answers-"));
process.env.DB_PATH = path.join(tmp, "test.db");

const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
const { getDb, getSqlite } = await import("@/lib/db/client");
const { upsertDraft, reviewAnswer, markSubmitted, listAnswers, overLimit } = await import("@/lib/apply/answers");

let app = 0;
const Q = "Why do you want to join Contoso? (max 150 words)";
beforeAll(() => {
  migrate(getDb(), { migrationsFolder: path.resolve("lib/db/migrations") });
  const db = getSqlite();
  const c = Number(db.prepare("insert into companies (slug, name) values ('contoso','Contoso')").run().lastInsertRowid);
  const j = Number(db.prepare("insert into jobs (company_id, title, dedupe_key) values (?, 'Graduate Consultant', 'n1')").run(c).lastInsertRowid);
  app = Number(db.prepare("insert into applications (job_id, status) values (?, 'applying')").run(j).lastInsertRowid);
});

describe("answers", () => {
  it("a re-draft replaces a draft in place", () => {
    expect(upsertDraft({ applicationId: app, question: Q, text: "first draft", wordLimit: 150 })).toMatchObject({ result: "inserted" });
    expect(upsertDraft({ applicationId: app, question: Q, text: "second draft", wordLimit: 150 })).toMatchObject({ result: "replaced_draft" });
    expect(listAnswers(app).map((a) => a.text)).toEqual(["second draft"]);
  });
  it("approval refuses an [ASK] gap and an over-limit answer", () => {
    const id = listAnswers(app)[0].id;
    expect(() => reviewAnswer(id, "I joined because [ASK: why consulting?]", true)).toThrow(/ASK/);
    expect(() => reviewAnswer(id, Array(151).fill("word").join(" "), true)).toThrow(/151 words, limit 150/);
  });
  it("once approved, a drafting run can't overwrite it; Jonno's own edit returns it to draft", () => {
    const id = listAnswers(app)[0].id;
    expect(reviewAnswer(id, "My approved answer.", true).status).toBe("approved");
    expect(upsertDraft({ applicationId: app, question: Q, text: "a model's rewrite" })).toMatchObject({ result: "kept_existing", status: "approved" });
    expect(listAnswers(app)[0].text).toBe("My approved answer.");
    expect(reviewAnswer(id, "My approved answer, tweaked.", false).status).toBe("draft");
    reviewAnswer(id, "My approved answer, tweaked.", true);
  });
  it("the form-filler sees only approved answers, and submitted is final", () => {
    upsertDraft({ applicationId: app, question: "Anything else?", text: "unapproved" });
    expect(listAnswers(app, "approved").map((a) => a.question)).toEqual([Q]);
    expect(markSubmitted(app)).toBe(1);
    expect(() => reviewAnswer(listAnswers(app)[0].id, "change", true)).toThrow(/submitted/);
  });
  it("counts words and characters against limits", () => {
    expect(overLimit({ text: "one two three", wordLimit: 2 })).toBe("3 words, limit 2");
    expect(overLimit({ text: "abcdef", charLimit: 5 })).toBe("6 characters, limit 5");
    expect(overLimit({ text: "fine", wordLimit: 10 })).toBeNull();
  });
});
