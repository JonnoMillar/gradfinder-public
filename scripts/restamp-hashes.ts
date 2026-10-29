/**
 * npm run: tsx scripts/restamp-hashes.ts [--dry-run]
 * One-off (2026-10-27, idempotent): `jobs.content_hash` used to hash the fetched HTML (or, for the ATS boards, the whole
 * board's JSON), which changes on every fetch. It is now `postingHash(title, description_text)` (lib/pipeline/content-hash.ts).
 * This rewrites every job's hash, and carries the new value into `role_evaluations.content_hash` and
 * `extraction_meta.content_hash` wherever they matched the old one, so nothing is re-evaluated or re-extracted just
 * because the hash changed. An evaluation that was already stale (hash differed) stays stale.
 */
import { getSqlite } from "../lib/db/client";
import { postingHash } from "../lib/pipeline/content-hash";

async function main() {
  const dry = process.argv.includes("--dry-run");
  const db = getSqlite();
  const jobs = db.prepare("select id, title, description_text, content_hash, extraction_meta from jobs").all() as
    { id: number; title: string; description_text: string | null; content_hash: string | null; extraction_meta: string | null }[];
  const evalHash = new Map((db.prepare("select job_id, content_hash from role_evaluations").all() as { job_id: number; content_hash: string | null }[]).map((e) => [e.job_id, e.content_hash]));
  let jobsChanged = 0, evalsCarried = 0, evalsLeftStale = 0, extractCarried = 0;
  const tx = db.transaction(() => {
    for (const j of jobs) {
      const next = postingHash(j.title, j.description_text);
      if (next === j.content_hash) continue;
      jobsChanged++;
      if (evalHash.has(j.id)) {
        if (evalHash.get(j.id) === j.content_hash) { evalsCarried++; if (!dry) db.prepare("update role_evaluations set content_hash = ? where job_id = ?").run(next, j.id); }
        else evalsLeftStale++;
      }
      let meta = j.extraction_meta;
      if (meta) {
        const m = JSON.parse(meta) as { content_hash?: string };
        if (m.content_hash && m.content_hash === j.content_hash) { extractCarried++; m.content_hash = next; meta = JSON.stringify(m); }
      }
      if (!dry) db.prepare("update jobs set content_hash = ?, extraction_meta = ? where id = ?").run(next, meta, j.id);
    }
  });
  tx();
  console.log(`${dry ? "dry run: " : ""}jobs rehashed ${jobsChanged}/${jobs.length}; evaluations carried ${evalsCarried}, left stale ${evalsLeftStale}; extraction carried ${extractCarried}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
