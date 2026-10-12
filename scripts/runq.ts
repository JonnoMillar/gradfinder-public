/**
 * npm run runq — what an Apply/Research run uses to talk to gradfinder (lib/runs/runs.ts).
 *
 *   npm run runq -- get <runId>                         the run, its job, application and answered questions (JSON)
 *   npm run runq -- note <runId> "<one line>"           heartbeat + the line Jonno sees ("Page 4 of 8: Application Details")
 *   npm run runq -- ask <runId> <file.json>             ALL the gaps at once: [{kind, prompt, options?, standing?, factKey?}]
 *                                                       then the run waits for Jonno (state needs_you). Exit straight after.
 *   npm run runq -- ready <runId> [--form-url u] [--title t] [--note n]
 *                                                       form filled as far as possible; Jonno reviews and submits
 *   npm run runq -- done <runId> [note]                 research finished
 *   npm run runq -- fail <runId> "<why>"
 *   npm run runq -- list                                live runs, and everything waiting on Jonno
 *   npm run runq -- usage                               usage per run (API-equivalent $) and per application sent
 *   npm run runq -- reap                                housekeeping: stale runs fail, submitted runs close
 *   npm run runq -- claim                               (external driver) take the next queued run, print its prompt file
 *
 * A file, not an argument, for `ask`: prompts have quotes and punctuation that Windows shells mangle.
 */
import fs from "node:fs";
import { getSqlite } from "../lib/db/client";
import { allQuestions, ask, claimNext, fail, finish, getRun, heartbeat, markReady, needsYou, reap } from "../lib/runs/runs";
import { prepareRun } from "../lib/runs/launch";
import { runUsage } from "../lib/runs/usage";
import { USER } from "../config/user";

const flag = (args: string[], name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function runIdOf(arg: string | undefined) {
  const id = Number(arg);
  if (!Number.isInteger(id) || id <= 0) throw new Error("usage: runq <cmd> <runId> …");
  return id;
}

async function main() {
  const [cmd, arg, ...rest] = process.argv.slice(2);
  const db = getSqlite();
  if (cmd === "list") {
    const live = db.prepare(`select r.id, r.kind, r.state, r.note, c.name as company, j.title from agent_runs r
      join jobs j on j.id = r.job_id join companies c on c.id = j.company_id
      where r.state in ('queued','running','needs_you','ready') order by r.id`).all();
    return console.log(JSON.stringify({ live, needsYou: needsYou().map((n) => ({ runId: n.run.id, company: n.company, questions: n.questions.map((q) => q.prompt) })) }, null, 2));
  }
  if (cmd === "usage") {
    // Is one-click worth it? Every run's usage, and what it cost per application that actually went out.
    const rows = (db.prepare(`select r.id, r.kind, r.state, c.name as company, a.status
      from agent_runs r join jobs j on j.id = r.job_id join companies c on c.id = j.company_id
      left join applications a on a.id = r.application_id order by r.id`).all() as { id: number; kind: string; state: string; company: string; status: string | null }[])
      .map((r) => ({ ...r, ...runUsage(Number(r.id)) }))
      .map((r) => ({ ...r, costUsd: +r.costUsd.toFixed(2), minutes: +r.minutes.toFixed(1) }));
    const total = rows.reduce((a, r) => a + r.costUsd, 0);
    // reap() closes an apply run as done once the application went out (status moved past applying).
    const sent = rows.filter((r) => r.kind === "apply" && r.state === "done");
    console.table(rows);
    return console.log(JSON.stringify({ totalUsd: +total.toFixed(2), applyRunsThatSent: sent.length,
      usdPerSentApplication: sent.length ? +(total / sent.length).toFixed(2) : null,
      note: "API-equivalent dollars from claude -p; on a Pro plan this is usage, not a bill. Deleted run folders count as 0." }));
  }
  if (cmd === "reap") return console.log(JSON.stringify(reap()));
  if (cmd === "claim") {
    // External driver (a Claude scheduled task instead of the runner): take the next queued run and print its prompt file.
    reap();
    const run = claimNext();
    if (!run) return console.log(JSON.stringify({ claimed: false }));
    const files = prepareRun(run);
    return console.log(JSON.stringify({ claimed: true, runId: run.id, kind: run.kind, promptFile: files.promptFile, mcpConfig: files.mcpFile,
      next: `Read the prompt file and follow it. Use the Playwright browser for an apply run.` }));
  }
  const id = runIdOf(arg);
  const run = getRun(id);
  if (!run) throw new Error(`No run ${id}`);
  if (cmd === "get") {
    const job = db.prepare(`select j.id, j.title, j.apply_url as applyUrl, j.canonical_url as postingUrl, c.name as company
      from jobs j join companies c on c.id = j.company_id where j.id = ?`).get(run.jobId);
    const app = run.applicationId
      ? db.prepare("select id, status, form_url as formUrl, employer_title as employerTitle from applications where id = ?").get(run.applicationId)
      : null;
    return console.log(JSON.stringify({ run, job, application: app, questions: allQuestions(id) }, null, 2));
  }
  if (cmd === "note") { heartbeat(id, rest.join(" ") || undefined); return console.log("ok"); }
  if (cmd === "ask") {
    const file = rest[0];
    if (!file) throw new Error("usage: runq ask <runId> <file.json>");
    const n = ask(id, JSON.parse(fs.readFileSync(file, "utf8")));
    return console.log(JSON.stringify({ asked: n, state: "needs_you", next: `Stop now. The run resumes when ${USER.name} has answered.` }));
  }
  if (cmd === "ready") {
    markReady(id, { formUrl: flag(rest, "--form-url"), employerTitle: flag(rest, "--title"), note: flag(rest, "--note") });
    return console.log(JSON.stringify({ state: "ready" }));
  }
  if (cmd === "done") { finish(id, rest.join(" ") || undefined); return console.log(JSON.stringify({ state: getRun(id)?.state })); }
  if (cmd === "fail") { fail(id, rest.join(" ") || "Failed"); return console.log(JSON.stringify({ state: getRun(id)?.state })); }
  throw new Error(`Unknown command ${cmd}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
