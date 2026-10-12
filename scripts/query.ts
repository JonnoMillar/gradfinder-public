/** npm run query -- "select ..."  — quick look at the DB. Non-SELECT statements are run and report changes. */
import { getSqlite } from "../lib/db/client";
const sql = process.argv.slice(2).join(" ");
if (!sql) { console.error("usage: npm run query -- \"select ...\""); process.exit(1); }
const stmt = getSqlite().prepare(sql);
if (stmt.reader) {
  const rows = stmt.all();
  console.table(rows.map((r) => Object.fromEntries(Object.entries(r as Record<string, unknown>).map(([k, v]) => [k, typeof v === "string" && v.length > 48 ? v.slice(0, 45) + "…" : v]))));
} else {
  console.log(stmt.run());
}
