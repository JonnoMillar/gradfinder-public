/**
 * npm run refilter — re-apply config/criteria.ts to every active job without re-sweeping, then rerank.
 * Run after editing the criteria. Prints what moved.
 *
 * npm run refilter -- --dry-run — the same decisions, written nowhere: lists every row that would change,
 * grouped by the new reason, with its full title. Eyeball every group before the real run.
 */
import { rankAll } from "../lib/pipeline/rank";
import { refilter } from "../lib/pipeline/refilter";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const r = refilter(undefined, { dryRun });
  const verb = dryRun ? "would be " : "";
  console.log(`checked ${r.checked} active jobs: ${r.newlyExcluded} ${verb}newly excluded, ${r.newlyKept} ${verb}newly kept, ${r.changed} rows ${dryRun ? "would change" : "changed"}`);

  const groups = new Map<string, typeof r.changes>();
  for (const c of r.changes) {
    const k = c.to ?? `KEPT (was ${c.from})`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  for (const [k, cs] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n${k}  (${cs.length})`);
    for (const c of cs) console.log(`  ${c.id}\t${c.title}${c.from && c.to ? `\t[was ${c.from}]` : ""}`);
  }

  if (dryRun) { console.log("\ndry run: nothing written"); return; }
  console.log("\nexcluded by reason:", r.byReason);
  console.log(`ranked ${rankAll()} active jobs`);
}
main().catch((e) => { console.error(e); process.exit(1); });
