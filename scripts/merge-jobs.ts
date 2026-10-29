/**
 * Merge a duplicate job into the one to keep: npm run merge-jobs -- <keepId> <dropId> [--apply]
 * Dry run unless --apply. Everything that points at the dropped job moves to the kept one (its job_sources, its
 * application and runs when the kept job has none), then the dropped row is deleted. Its derived rows
 * (evaluation, research) go with it by cascade: the kept job has its own.
 */
import { getSqlite } from "@/lib/db/client";

async function main() {
  const [keep, drop] = process.argv.slice(2).filter((a) => !a.startsWith("--")).map(Number);
  const apply = process.argv.includes("--apply");
  if (!keep || !drop || keep === drop) { console.error("usage: merge-jobs <keepId> <dropId> [--apply]"); process.exitCode = 1; return; }
  const db = getSqlite();
  const job = (id: number) => db.prepare("select id, title, dedupe_key, apply_url from jobs where id = ?").get(id);
  if (!job(keep) || !job(drop)) { console.error("both jobs must exist"); process.exitCode = 1; return; }
  console.log("keep", job(keep), "\ndrop", job(drop));

  const refs = db.prepare("select m.name as tbl, f.\"from\" as col from sqlite_master m, pragma_foreign_key_list(m.name) f where m.type='table' and f.\"table\"='jobs'")
    .all() as { tbl: string; col: string }[];
  const tx = db.transaction(() => {
    for (const { tbl, col } of refs) {
      const n = (db.prepare(`select count(*) n from ${tbl} where ${col} = ?`).get(drop) as { n: number }).n;
      if (!n) continue;
      // Tables with one row per job (applications, evaluations, research): the kept job's own row wins.
      const clash = (db.prepare(`select count(*) n from ${tbl} where ${col} = ?`).get(keep) as { n: number }).n > 0
        && (db.pragma(`index_list(${tbl})`) as { unique: number; name: string }[]).some((i) => i.unique &&
          (db.pragma(`index_info(${i.name})`) as { name: string }[]).length === 1 && (db.pragma(`index_info(${i.name})`) as { name: string }[])[0].name === col);
      console.log(`${tbl}.${col}: ${n} row(s) ${clash ? "left to cascade/delete (kept job has its own)" : "moved to the kept job"}`);
      if (!clash) db.prepare(`update ${tbl} set ${col} = ? where ${col} = ?`).run(keep, drop);
    }
    db.prepare("delete from jobs where id = ?").run(drop);
    if (!apply) throw new Error("dry run");
  });
  try { tx(); console.log("merged"); } catch (e) { console.log(e instanceof Error && e.message === "dry run" ? "dry run: nothing changed (add --apply)" : e); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
