/**
 * npm run sweep [-- --source higherin,targetjobs] [--limit 50]
 * Exit code 1 if any source failed, so a cron/CI run can't pass silently.
 */
import { parseArgs } from "node:util";
import { runSweep } from "../lib/pipeline/run";
import { pickAdapters } from "../lib/pipeline/sources";

async function main() {
  const { values } = parseArgs({ options: { source: { type: "string" }, limit: { type: "string" } } });
  const adapters = pickAdapters(values.source?.split(",").map((s) => s.trim()).filter(Boolean));
  const limit = values.limit ? Number(values.limit) : undefined;

  const { outcomes } = await runSweep({ adapters, limit, trigger: "cli" });
  console.table(outcomes.map((o) => ({ source: o.source, status: o.status, discovered: o.discovered, new: o.inserted, updated: o.updated, ms: o.durationMs, error: o.error?.slice(0, 80) ?? "" })));
  if (outcomes.some((o) => o.status === "failed")) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
