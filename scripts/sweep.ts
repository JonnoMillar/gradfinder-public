/**
 * npm run sweep [-- --source higherin,targetjobs] [--limit 50] [--no-liveness]
 * Then runs `npm run liveness` (employer-side open/closed check) unless --limit or --no-liveness.
 * Exit code 1 if any source failed or liveness failed, so a cron/CI run can't pass silently.
 */
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { runSweep } from "../lib/pipeline/run";
import { pickAdapters } from "../lib/pipeline/sources";

async function main() {
  const { values } = parseArgs({ options: { source: { type: "string" }, limit: { type: "string" }, "no-liveness": { type: "boolean", default: false } } });
  const adapters = pickAdapters(values.source?.split(",").map((s) => s.trim()).filter(Boolean));
  const limit = values.limit ? Number(values.limit) : undefined;

  const { outcomes } = await runSweep({ adapters, limit, trigger: "cli" });
  console.table(outcomes.map((o) => ({ source: o.source, status: o.status, discovered: o.discovered, new: o.inserted, updated: o.updated, ms: o.durationMs, error: o.error?.slice(0, 80) ?? "" })));
  if (outcomes.some((o) => o.status === "failed")) process.exitCode = 1;

  // Job boards keep listing roles the employer has closed, so a sweep is only half done until liveness has run.
  // Skipped for --limit (a slice test) and --no-liveness. shell:true because npm is npm.cmd on Windows.
  if (!limit && !values["no-liveness"]) {
    const r = spawnSync("npm run liveness", { stdio: "inherit", shell: true });
    if (r.status !== 0) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
