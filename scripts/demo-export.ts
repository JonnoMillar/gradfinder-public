/**
 * Writes demo/catalogue.json: the real public postings the demo uses (docs/superpowers/specs/2026-10-12-public-showcase.md),
 * copied out of the author's data/app.db so the public repo can build the demo without it. Only layer 1–2 data about
 * roles and employers leaves; nothing personal does:
 *   - dr.commute.* facts are journeys from Jonno's home stations: dropped
 *   - dr.values facts carry Claude's pick of one of Jonno's stories: the pick is stripped
 *   - evaluations: only the role description parts (family, one line, day to day); the scores and reasons were his
 *   - role_research (fit against his store, his angle), applications, emails, runs: never read
 * Opens app.db read-only. Run: npx tsx scripts/demo-export.ts
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { EVALUATIONS } from "../demo/alex";

/**
 * The demo is hosted publicly, so a posting's text ships as a short excerpt, not the employer's whole page: the first
 * paragraphs up to ~400 characters, cut at a word. The role page links to the original. Exported for the test.
 */
export function excerpt(text: string | null, max = 400): string | null {
  if (!text) return null;
  let out = "";
  for (const p of text.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean)) {
    if (out && out.length + p.length > max) break;
    out += (out ? "\n\n" : "") + p;
    if (out.length >= max) break;
  }
  if (out.length > max) out = out.slice(0, out.lastIndexOf(" ", max)).replace(/[\s,;:.–-]+$/, "");
  return `${out}…\n\nExcerpt only: the full posting is on the employer's site (Open posting).`;
}

function main() {
  const db = new Database(path.join(process.cwd(), "data", "app.db"), { readonly: true, fileMustExist: true });
  const ids = EVALUATIONS.map((e) => e.id);
  const q = (sql: string, args: unknown[] = []) => db.prepare(sql).all(...args) as Record<string, unknown>[];
  const marks = (n: number) => Array(n).fill("?").join(",");

  const jobs = q(`select * from jobs where id in (${marks(ids.length)})`, ids)
    .map((j): Record<string, unknown> => ({ ...j, description_text: excerpt(j.description_text as string | null), description_html: null }));
  const missing = ids.filter((id) => !jobs.some((j) => j.id === id));
  if (missing.length) throw new Error(`jobs not in app.db: ${missing.join(", ")}`);
  const companyIds = [...new Set(jobs.map((j) => Number(j.company_id)))];

  const facts = [
    ...q(`select * from facts where entity_type='job' and entity_id in (${marks(ids.length)})`, ids),
    ...q(`select * from facts where entity_type='company' and entity_id in (${marks(companyIds.length)})`, companyIds),
  ].filter((f) => !String(f.field).startsWith("dr.commute."))
    .map((f) => {
      if (!String(f.field).startsWith("dr.values.") || typeof f.value_json !== "string") return f;
      const v = JSON.parse(f.value_json);
      delete v.story;
      return { ...f, value_json: JSON.stringify(v) };
    });
  const personal = facts.filter((f) => /jonno/i.test(`${f.value_text} ${f.value_json ?? ""}`));
  if (personal.length) throw new Error(`facts naming Jonno: ${personal.map((f) => f.id).join(", ")}`);

  const out = {
    exportedAt: new Date().toISOString(),
    companies: q(`select * from companies where id in (${marks(companyIds.length)})`, companyIds),
    jobs,
    job_sources: q(`select * from job_sources where job_id in (${marks(ids.length)})`, ids).map((s) => ({ ...s, snapshot_id: null })),
    facts,
    news_items: q(`select * from news_items where company_id in (${marks(companyIds.length)})`, companyIds),
    role_basics: q(`select job_id, family, one_line, day_to_day, salary_from_posting, confidence from role_evaluations
      where job_id in (${marks(ids.length)})`, ids),
  };
  const file = path.join(process.cwd(), "demo", "catalogue.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`wrote ${file}: ${out.jobs.length} jobs, ${out.companies.length} companies, ${out.facts.length} facts, ` +
    `${out.news_items.length} news, ${out.role_basics.length} role basics`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) main();
