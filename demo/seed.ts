/**
 * Builds the demo DB (at `DB_PATH`) from demo/catalogue.json (real public postings, excerpts only) and demo/alex.ts
 * (the fictional user), dated relative to today so the demo never goes stale. Never opens data/app.db.
 * Used by `npm run demo:seed` and, in the hosted demo, by instrumentation.ts on every cold start.
 */
import fs from "node:fs";
import path from "node:path";

const DAY_MS = 86_400_000;
/** midday, so a day offset never lands on the wrong date across a clock change */
const dayAt = (d: number, hour = 12) => {
  const t = new Date(); t.setHours(hour, 0, 0, 0);
  return new Date(t.getTime() + d * DAY_MS);
};
const isoDate = (d: number) => {
  const t = dayAt(d);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};
const isoTime = (d: number, hour = 12) => dayAt(d, hour).toISOString();

/** Rebuilds the demo DB at `DB_PATH` from the catalogue and Alex's file, dated relative to today. */
export async function seedDemo(log: (s: string) => void = console.log) {
  const DB = process.env.DB_PATH;
  if (!DB) throw new Error("seedDemo: set DB_PATH first");
  try {
    for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EPERM") throw e;
    throw new Error(`${DB} is open: stop \`npm run demo\` first (Windows can't delete an open file)`);
  }

  const { getDb, getSqlite } = await import("@/lib/db/client");
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { saveEvaluation } = await import("@/lib/evaluate");
  const { refilter } = await import("@/lib/pipeline/refilter");
  const { rankAll } = await import("@/lib/pipeline/rank");
  const { EVALUATIONS, DEADLINES, APPLICATIONS, EMAILS } = await import("./alex");

  migrate(getDb(), { migrationsFolder: "./lib/db/migrations" });
  const sqlite = getSqlite();
  const cat = JSON.parse(fs.readFileSync(path.join(process.cwd(), "demo", "catalogue.json"), "utf8"));

  // Only the columns the migrations create: the author's app.db has drifted (news_items.relevance, which no code uses).
  const insertAll = (table: string, rows: Record<string, unknown>[]) => {
    const known = new Set((sqlite.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
    for (const r of rows) {
      const cols = Object.keys(r).filter((c) => known.has(c));
      sqlite.prepare(`insert into ${table} (${cols.join(",")}) values (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => r[c]));
    }
  };
  sqlite.transaction(() => {
    insertAll("companies", cat.companies);
    insertAll("jobs", cat.jobs);
    insertAll("job_sources", cat.job_sources);
    insertAll("facts", cat.facts);
    insertAll("news_items", cat.news_items);

    // Every role live and seen today; deadlines from DEADLINES, the rest none (a real but past date would read as stale).
    const now = isoTime(0);
    sqlite.prepare("update jobs set is_active = 1, excluded_reason = null, last_seen = ?, deadline = null, deadline_text = null").run(now);
    sqlite.prepare("update job_sources set last_seen = ?").run(now);
    for (const [id, d] of Object.entries(DEADLINES)) sqlite.prepare("update jobs set deadline = ? where id = ?").run(isoDate(d), Number(id));
  })();

  const basics = new Map<number, Record<string, unknown>>(cat.role_basics.map((b: Record<string, unknown>) => [Number(b.job_id), b]));
  const keys = ["workFit", "chance", "companyType", "careerPath", "sector", "pay"] as const;
  for (const e of EVALUATIONS) {
    const b = basics.get(e.id);
    if (!b) throw new Error(`no role basics for job ${e.id}`);
    saveEvaluation({
      jobId: e.id, gradRole: e.grad ?? "yes", gradRoleReason: "An entry-level role for 2027 graduates.",
      family: b.family, oneLine: b.one_line, dayToDay: b.day_to_day,
      scores: Object.fromEntries(keys.map((k, i) => [k, e.s[i]])),
      reasons: Object.fromEntries(keys.map((k, i) => [k, e.r[i]])),
      stretch: e.stretch ?? null, dealbreakers: [], salaryFromPosting: b.salary_from_posting ?? null,
      confidence: b.confidence ?? "medium",
    }, "claude-opus-5-5 (demo: Alex Morgan)");
  }

  sqlite.transaction(() => {
    const appIds = new Map<number, number>();
    for (const a of APPLICATIONS) {
      const r = sqlite.prepare(`insert into applications (job_id, status, next_action, next_action_due, notes, applied_at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?)`).run(a.id, a.status, a.nextAction ?? null, a.nextDue == null ? null : isoDate(a.nextDue),
        a.notes ?? null, a.appliedDay == null ? null : isoTime(a.appliedDay), isoTime(a.log.at(-1)![0]));
      appIds.set(a.id, Number(r.lastInsertRowid));
      for (const [d, from, to] of a.log) {
        sqlite.prepare("insert into activity_log (application_id, from_status, to_status, at) values (?, ?, ?, ?)")
          .run(Number(r.lastInsertRowid), from, to, isoTime(d, 10));
      }
    }
    EMAILS.forEach((m, i) => {
      const appId = appIds.get(m.job);
      if (!appId) throw new Error(`email for untracked job ${m.job}`);
      sqlite.prepare(`insert into email_updates (gmail_message_id, received_at, sender, subject, kind, summary, application_id,
        status_applied, action_text, action_due) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(`demo-${i + 1}`, isoTime(m.day, 9), m.sender, m.subject, m.kind, m.summary, appId, m.statusApplied ?? null,
          m.action ?? null, m.due == null ? null : isoDate(m.due));
    });
  })();

  const f = refilter();
  const ranked = rankAll();
  const kept = sqlite.prepare("select count(*) n from jobs where excluded_reason is null").get() as { n: number };
  log(`demo.db: ${cat.jobs.length} roles (${kept.n} kept), ${EVALUATIONS.length} evaluations, ` +
    `${APPLICATIONS.length} applications, ${EMAILS.length} emails; refilter ${JSON.stringify(f).slice(0, 120)}; ranked ${ranked}`);
  if (kept.n < cat.jobs.length) {
    log(JSON.stringify(sqlite.prepare("select id, title, excluded_reason from jobs where excluded_reason is not null").all()));
  }
}
