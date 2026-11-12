/**
 * Import a Claude research batch of company headcounts (data/cache/size/out-NN.json) as `headcount` facts, then
 * refresh companies.size_band.
 *
 *   npx tsx scripts/size-import.ts data/cache/size/out-01.json [more.json ...]   [--dry]
 *
 * Each item is {id, employees_text, source_url, quote, source_kind, confidence, scope} or {id, unknown: true}.
 * Refused (reported, not written): no source_url or quote, wikipedia/wikidata sources, text that is not a headcount
 * (lib/ui/size.ts), a company that already has the same source_url. Scope ("global"/"uk") is kept in value_json.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { getSqlite } from "@/lib/db/client";
import { sizeBandOf } from "@/lib/ui/size";
import { fillBands } from "./size-bands";

const Item = z.union([
  z.object({ id: z.number(), unknown: z.literal(true) }).passthrough(),
  z.object({
    id: z.number(), employees_text: z.string().min(3), source_url: z.string().url(), quote: z.string().min(5),
    source_kind: z.enum(["company_site", "news", "search_snippet"]), confidence: z.enum(["high", "medium", "low"]),
    scope: z.enum(["global", "uk", "unclear"]).default("unclear"),
  }),
]);

function main() {
  const dry = process.argv.includes("--dry");
  const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  // --skip=1,2: company ids whose figure was checked by hand and rejected (wrong entity, group total, weak source)
  const skip = new Set((process.argv.find((a) => a.startsWith("--skip="))?.slice(7) ?? "").split(",").filter(Boolean).map(Number));
  const db = getSqlite();
  const exists = db.prepare("select 1 from facts where entity_type='company' and entity_id=? and field='headcount' and source_url=?");
  const ins = db.prepare(
    `insert into facts (entity_type, entity_id, field, value_text, value_json, source_url, source_kind, confidence)
     values ('company', ?, 'headcount', ?, ?, ?, ?, ?)`);
  let ok = 0, unknown = 0; const refused: string[] = [];
  for (const f of files) {
    for (const raw of JSON.parse(readFileSync(f, "utf8")) as unknown[]) {
      const p = Item.safeParse(raw);
      if (!p.success) { refused.push(`${(raw as { id?: number }).id}: bad shape`); continue; }
      const it = p.data;
      if ("unknown" in it) { unknown++; continue; }
      if (skip.has(it.id)) { refused.push(`${it.id}: skipped by hand`); continue; }
      if (/wikipedia|wikidata/i.test(it.source_url)) { refused.push(`${it.id}: wikipedia source`); continue; }
      if (!sizeBandOf(it.employees_text)) { refused.push(`${it.id}: not a headcount "${it.employees_text}"`); continue; }
      if (exists.get(it.id, it.source_url)) { refused.push(`${it.id}: already imported`); continue; }
      if (!dry) ins.run(it.id, it.employees_text, JSON.stringify({ via: "claude_research", quote: it.quote, scope: it.scope }), it.source_url, it.source_kind, it.confidence);
      ok++;
    }
  }
  console.log(`${dry ? "would import" : "imported"} ${ok}, unknown ${unknown}, refused ${refused.length}`);
  for (const r of refused) console.log("  refused", r);
  if (!dry) fillBands();
}
main();
