/** Apply/Research runs: one live run per role, one running at a time, questions re-queue, the reaper cleans up. */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gradfinder-runs-"));
process.env.DB_PATH = path.join(tmp, "test.db");

const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
const { getDb, getSqlite } = await import("@/lib/db/client");
const R = await import("@/lib/runs/runs");

let jobA = 0;
let jobB = 0;
const at = (ms: number) => new Date(Date.UTC(2026, 8, 30, 12, 0, 0) + ms).toISOString();

beforeAll(() => {
  migrate(getDb(), { migrationsFolder: path.resolve("lib/db/migrations") });
  const db = getSqlite();
  const c = Number(db.prepare("insert into companies (slug, name) values ('acme','Acme')").run().lastInsertRowid);
  jobA = Number(db.prepare("insert into jobs (company_id, title, dedupe_key) values (?, 'Analyst', 'a1')").run(c).lastInsertRowid);
  jobB = Number(db.prepare("insert into jobs (company_id, title, dedupe_key) values (?, 'Consultant', 'b1')").run(c).lastInsertRowid);
});

describe("requesting runs", () => {
  it("apply creates the application as Applying and queues one run", () => {
    const r = R.requestRun(jobA, "apply", at(0));
    expect(r).toMatchObject({ created: true, state: "queued" });
    const app = getSqlite().prepare("select status from applications where job_id = ?").get(jobA) as { status: string };
    expect(app.status).toBe("applying");
    expect(R.getRun(r.runId)?.applicationId).not.toBeNull();
  });
  it("a second click returns the live run instead of duplicating", () => {
    const again = R.requestRun(jobA, "apply", at(1));
    expect(again.created).toBe(false);
    expect((getSqlite().prepare("select count(*) n from agent_runs where job_id = ?").get(jobA) as { n: number }).n).toBe(1);
  });
  it("research does not touch the application and may coexist with an apply run", () => {
    const r = R.requestRun(jobB, "research", at(2));
    expect(R.getRun(r.runId)?.applicationId).toBeNull();
    expect(getSqlite().prepare("select 1 from applications where job_id = ?").get(jobB)).toBeUndefined();
    expect(R.requestRun(jobA, "research", at(3)).created).toBe(true);
  });
});

describe("running, asking, answering", () => {
  it("claims the oldest queued run, and only one at a time", () => {
    const first = R.claimNext(at(10));
    expect(first?.kind).toBe("apply");
    expect(first?.state).toBe("running");
    expect(R.claimNext(at(11))).toBeNull();
  });
  it("asks all gaps at once (a repeated prompt in one call is stored once), then waits", () => {
    const run = R.activeRun(jobA, "apply")!;
    R.ask(run.id, [
      { kind: "choice", prompt: "Which stream?", options: ["Operations", "Digital"] },
      { kind: "declaration", prompt: "Ever worked here?", standing: true, factKey: "eligibility.worked_here" },
      { kind: "choice", prompt: "Which stream?", options: ["Operations", "Digital"] },
    ], at(20));
    expect(R.getRun(run.id)?.state).toBe("needs_you");
    expect(R.openQuestions(run.id)).toHaveLength(2);
    expect(R.needsYou()).toHaveLength(1);
  });
  it("cannot ask when the run is not running", () => {
    const run = R.activeRun(jobA, "apply")!;
    expect(() => R.ask(run.id, [{ kind: "fact", prompt: "Anything else?" }])).toThrow(/not running/);
  });
  it("an answer must be one of the offered options and non-empty", () => {
    const [q1] = R.openQuestions(R.activeRun(jobA, "apply")!.id);
    expect(() => R.answer(q1.id, "Digital Consultant")).toThrow(/offered options/);
    expect(() => R.answer(q1.id, "  ")).toThrow(/empty/);
  });
  it("answering the last open question re-queues the run", () => {
    const run = R.activeRun(jobA, "apply")!;
    const [q1, q2] = R.openQuestions(run.id);
    expect(R.answer(q1.id, "Digital", at(30))).toMatchObject({ requeued: false, remaining: 1 });
    expect(R.answer(q2.id, "No", at(31))).toMatchObject({ requeued: true, remaining: 0 });
    expect(R.getRun(run.id)?.state).toBe("queued");
  });
  it("the next claim resumes it (attempt 2) and it can be marked ready with the employer's title", () => {
    const run = R.claimNext(at(40))!;
    expect(run.attempts).toBe(2);
    R.markReady(run.id, { formUrl: "https://acme.tal.net/form/1", employerTitle: "Analyst Programme - London" }, at(50));
    expect(R.getRun(run.id)?.state).toBe("ready");
    const app = getSqlite().prepare("select form_url, employer_title from applications where job_id = ?").get(jobA) as Record<string, string>;
    expect(app).toEqual({ form_url: "https://acme.tal.net/form/1", employer_title: "Analyst Programme - London" });
  });
});

describe("housekeeping", () => {
  it("a ready run becomes done once the application is Applied", () => {
    getSqlite().prepare("update applications set status='applied' where job_id = ?").run(jobA);
    expect(R.reap(new Date(at(60))).done).toBe(1);
    expect(R.activeRun(jobA, "apply")).toBeNull();
  });
  it("a running run with no heartbeat for 10 minutes fails; a live one is left alone", () => {
    const research = R.claimNext(at(100))!;
    expect(research.kind).toBe("research");
    R.heartbeat(research.id, "working", at(100));
    expect(R.reap(new Date(at(100 + 9 * 60_000))).failed).toBe(0);
    expect(R.reap(new Date(at(100 + 11 * 60_000))).failed).toBe(1);
    expect(R.getRun(research.id)).toMatchObject({ state: "failed", error: "No heartbeat for 10 minutes" });
  });
  it("the 30-minute cap applies even with fresh heartbeats", () => {
    const next = R.claimNext(at(3_000_000))!;
    R.heartbeat(next.id, "still going", at(3_000_000 + 31 * 60_000 - 1000));
    expect(R.reap(new Date(at(3_000_000 + 31 * 60_000))).failed).toBe(1);
    expect(R.getRun(next.id)?.error).toBe("Hit the 30-minute cap");
  });
  it("the cap counts from the current pass, so a run resumed hours later is not killed at once", () => {
    // Regression (run 8, 2026-10-07): the cap counted from the FIRST pass, so a resume after 30 min died in seconds.
    const db = getSqlite();
    for (const r of db.prepare("select id from agent_runs where state in ('queued','running')").all() as { id: number }[]) R.cancel(r.id, at(4_900_000));
    const c = (db.prepare("select id from companies limit 1").get() as { id: number }).id;
    const jobC = Number(db.prepare("insert into jobs (company_id, title, dedupe_key) values (?, 'Resume test', 'c1')").run(c).lastInsertRowid);
    const T = 5_000_000;
    const { runId } = R.requestRun(jobC, "apply", at(T));
    expect(R.claimNext(at(T + 1))?.id).toBe(runId);
    R.ask(runId, [{ kind: "fact", prompt: "Middle names?" }], at(T + 2));
    R.answer(R.openQuestions(runId)[0].id, "none", at(T + 2 * 60 * 60_000));
    expect(R.claimNext(at(T + 2 * 60 * 60_000 + 1))?.id).toBe(runId);
    expect(R.reap(new Date(at(T + 2 * 60 * 60_000 + 60_000))).failed).toBe(0);
    expect(R.getRun(runId)?.state).toBe("running");
    R.cancel(runId, at(T + 2 * 60 * 60_000 + 61_000));
  });
  it("cancel works on a queued run and frees the role for a new one", () => {
    const r = R.requestRun(jobB, "apply", at(4_000_000));
    expect(R.cancel(r.runId, at(4_000_001))).toBe(true);
    expect(R.requestRun(jobB, "apply", at(4_000_002)).created).toBe(true);
  });
});

describe("the filled-form window (single-page forms)", () => {
  const T0 = 6_000_000;
  it("while an apply run is ready, only research runs are claimed; the window is wanted for 2 hours", () => {
    const apply = R.activeRun(jobB, "apply")!;
    const claimed = R.claimNext(at(T0))!;
    expect(claimed.id).toBe(apply.id);
    R.markReady(apply.id, { formUrl: "https://boards.greenhouse.io/x/jobs/1" }, at(T0 + 10));
    expect(R.readyApplyRun()?.id).toBe(apply.id);
    const other = R.requestRun(jobA, "apply", at(T0 + 20)).runId;
    expect(R.claimNext(at(T0 + 30), ["research"])).toBeNull();
    expect(R.getRun(other)?.state).toBe("queued");
    const t = (ms: number) => new Date(at(T0 + ms)).getTime();
    expect(R.browserWanted(t(60 * 60_000))).toBe(true);
    // the queued second run still wants a browser; cancel it to see the ready run's own window expire
    R.cancel(other, at(T0 + 40));
    expect(R.browserWanted(t(3 * 60 * 60_000))).toBe(false);
  });
  it("reap cancels a ready run after 2 hours and says why", () => {
    const apply = R.readyApplyRun()!;
    expect(R.reap(new Date(at(T0 + 60 * 60_000))).failed).toBe(0);
    expect(R.getRun(apply.id)?.state).toBe("ready");
    R.reap(new Date(at(T0 + 2 * 60 * 60_000 + 60_000)));
    expect(R.getRun(apply.id)).toMatchObject({ state: "cancelled" });
    expect(R.getRun(apply.id)?.note).toMatch(/closed after 2 hours/);
    expect(R.readyApplyRun()).toBeNull();
  });
});
