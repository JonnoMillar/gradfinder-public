/**
 * Fill companies.size_band from each company's best `headcount` fact (lib/ui/size.ts).
 *
 *   npx tsx scripts/size-bands.ts          write bands (blank or changed only)
 *   npx tsx scripts/size-bands.ts --dry    print what would change
 *
 * Best fact = highest confidence, then not-Indeed (a stated figure beats a review-site band), then newest.
 * Re-run after importing headcount facts (research, sweep).
 */
import { getSqlite } from "@/lib/db/client";
import { sizeBandOf } from "@/lib/ui/size";

const RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

export function fillBands(dry = false) {
  const db = getSqlite();
  const rows = db.prepare(
    `select entity_id as id, value_text as text, confidence, source_kind from facts
     where entity_type = 'company' and field = 'headcount' order by id`,
  ).all() as { id: number; text: string; confidence: string; source_kind: string }[];

  const best = new Map<number, { band: string; score: number }>();
  for (const r of rows) {
    const band = sizeBandOf(r.text);
    if (!band) continue;
    const score = (RANK[r.confidence] ?? 0) * 10 + (r.source_kind === "reviews" ? 0 : 5); // later rows win ties
    const cur = best.get(r.id);
    if (!cur || score >= cur.score) best.set(r.id, { band, score });
  }
  const upd = db.prepare("update companies set size_band = ? where id = ? and size_band is not ?");
  let changed = 0;
  for (const [id, { band }] of best) {
    if (dry) { console.log(id, band); changed++; continue; }
    changed += upd.run(band, id, band).changes;
  }
  console.log(`${dry ? "would set" : "set"} ${changed} of ${best.size} companies with a headcount fact`);
}
if (require.main === module) fillBands(process.argv.includes("--dry"));
