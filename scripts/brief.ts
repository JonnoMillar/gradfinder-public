/**
 * npm run brief -- <jobId> [--stdout]
 * Writes profile/research/<company>-<jobId>.md: the sourced research brief a drafting run may cite (lib/apply/brief.ts).
 * profile/ is gitignored. --stdout prints instead of writing.
 */
import fs from "node:fs";
import path from "node:path";
import { buildBrief } from "../lib/apply/brief";
import { PROFILE } from "../lib/kit";

async function main() {
  const id = Number(process.argv[2]);
  if (!Number.isInteger(id) || id <= 0) throw new Error("usage: npm run brief -- <jobId> [--stdout]");
  const b = buildBrief(id);
  if (!b) throw new Error(`No job ${id}`);
  if (process.argv.includes("--stdout")) return console.log(b.markdown);
  const dir = path.join(PROFILE(), "research");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, b.fileName);
  fs.writeFileSync(file, b.markdown, "utf8");
  console.log(`wrote ${path.relative(process.cwd(), file)} (${b.markdown.length} chars)`);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
