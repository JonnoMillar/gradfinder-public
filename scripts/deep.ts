/**
 * npm run deep — deep research on a role (lib/apply/research.ts, runbook docs/automation/research-role.md).
 *
 *   npm run deep -- status                              which roles have deep research, and when
 *   npm run deep -- queue [--top 15] [--json]           roles due research: top N by rank + interested/applying, soonest deadline first
 *   npm run deep -- import <file.json>... [--model m]   validate + store a research run, then fetch commute times
 *   npm run deep -- commute <jobId>...                  re-fetch TfL journey times to the role's office
 *   npm run deep -- values <file.json>...               store an employer's values (company-level, own import)
 *   npm run deep -- check <file.json>...                validate only (a research run checks its own output)
 */
import fs from "node:fs";
import { getSqlite } from "../lib/db/client";
import { ResearchInput, researchQueue, saveCommutes, saveResearch, saveValues } from "../lib/apply/research";

function flag(args: string[], name: string) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function commute(jobId: number) {
  try {
    const cs = await saveCommutes(jobId);
    console.log(JSON.stringify({ jobId, commute: cs.map((c) => `${c.minutes} min from ${c.from} (${c.summary})`) }));
    return true;
  } catch (e) {
    console.log(JSON.stringify({ jobId, commuteError: e instanceof Error ? e.message : String(e) }));
    return false;
  }
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "status") {
    const rows = getSqlite().prepare(`
      select r.job_id, c.name company, j.title, r.researched_at, r.model,
             (select count(*) from facts f where f.entity_type='job' and f.entity_id=r.job_id and f.field like 'dr.%') job_claims,
             json_array_length(r.unknowns) unknowns
      from role_research r join jobs j on j.id = r.job_id join companies c on c.id = j.company_id
      order by r.researched_at desc`).all();
    return console.table(rows);
  }
  if (cmd === "import") {
    const model = flag(args, "--model") ?? "claude-sonnet-5";
    const files = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--model");
    if (!files.length) throw new Error("usage: deep import <file.json>... [--model m]");
    let failed = 0;
    for (const file of files) {
      const raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")) as unknown;
      try {
        const r = saveResearch(raw, model);
        console.log(JSON.stringify({ file, ...r }));
        if (!(await commute(r.jobId))) failed++;
      } catch (e) {
        failed++;
        console.log(JSON.stringify({ file, error: e instanceof Error ? e.message.slice(0, 1500) : String(e) }));
      }
    }
    if (failed) process.exitCode = 1;
    return;
  }
  if (cmd === "queue") {
    const q = researchQueue(Number(flag(args, "--top") ?? 15));
    if (args.includes("--json")) return console.log(JSON.stringify(q, null, 1));
    return console.table(q);
  }
  if (cmd === "check") {
    // validate without storing: for a research run to fix its own file before handing it over
    for (const file of args) {
      const r = ResearchInput.safeParse(JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")));
      console.log(JSON.stringify(r.success
        ? { file, ok: true, claims: r.data.claims.length, unknowns: r.data.unknowns.map((u) => u.section) }
        : { file, ok: false, issues: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }));
      if (!r.success) process.exitCode = 1;
    }
    return;
  }
  if (cmd === "values") {
    if (!args.length) throw new Error("usage: deep values <file.json>...");
    for (const file of args) {
      try { console.log(JSON.stringify({ file, ...saveValues(JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""))) })); }
      catch (e) { process.exitCode = 1; console.log(JSON.stringify({ file, error: e instanceof Error ? e.message.slice(0, 1500) : String(e) })); }
    }
    return;
  }
  if (cmd === "commute") {
    const ids = args.map(Number).filter(Boolean);
    if (!ids.length) throw new Error("usage: deep commute <jobId>...");
    for (const id of ids) if (!(await commute(id))) process.exitCode = 1;
    return;
  }
  throw new Error("usage: deep status | queue [--top N] | check <files...> | import <files...> [--model m] | values <files...> | commute <jobId>...");
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
