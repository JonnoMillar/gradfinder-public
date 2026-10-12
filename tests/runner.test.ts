/** The runner spawns a (fake) claude, keeps one run at a time, and explains a run whose process ends without a result. */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gradfinder-runner-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.RUNNER_CDP_PORT = "59999"; // never the real run browser's port: the tidy step would close it
process.chdir(tmp); // run files land in <tmp>/data/runs, not the repo

const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
const { getDb, getSqlite } = await import("@/lib/db/client");
const R = await import("@/lib/runs/runs");
const { startRunner, explainExit } = await import("@/lib/runs/runner");

const wait = async (cond: () => boolean, ms = 8000) => {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 40));
  }
};

let job = 0;
beforeAll(() => {
  migrate(getDb(), { migrationsFolder: path.resolve(__dirname, "../lib/db/migrations") });
  const db = getSqlite();
  const c = Number(db.prepare("insert into companies (slug, name) values ('acme','Acme')").run().lastInsertRowid);
  job = Number(db.prepare("insert into jobs (company_id, title, dedupe_key) values (?, 'Analyst', 'a1')").run(c).lastInsertRowid);
});

describe("explainExit", () => {
  it("names the login problem in plain words", () => {
    expect(explainExit("Failed to authenticate: OAuth session expired", 1)).toMatch(/claude login/);
    expect(explainExit("something else", 2)).toMatch(/exit 2/);
  });
});

describe("runner with a fake claude", () => {
  it("a process that ends without a result fails the run with a reason, and frees the queue", async () => {
    const fake = path.join(tmp, "fake-claude.js");
    fs.writeFileSync(fake, 'console.log("Failed to authenticate: OAuth session expired"); process.exit(1);');
    process.env.CLAUDE_BIN = process.execPath;
    process.env.CLAUDE_BIN_ARGS = JSON.stringify([fake]);
    const { runId } = R.requestRun(job, "research");
    const stop = startRunner({ driver: "claude", pollMs: 40 });
    try {
      await wait(() => R.getRun(runId)?.state === "failed");
      expect(R.getRun(runId)?.error).toMatch(/claude login/);
      expect(fs.existsSync(path.join(tmp, "data", "runs", String(runId), "prompt.md"))).toBe(true);
      // the queue is free again: a new run is picked up
      const second = R.requestRun(job, "research").runId;
      await wait(() => R.getRun(second)?.state === "failed");
    } finally {
      stop();
    }
  });
});
