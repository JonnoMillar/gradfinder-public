/**
 * "Fill a form": an apply run for a form that is not a sweep result. The run machinery keys on a `jobs` row, so a
 * minimal one is made: dedupe_key `manual|<url>`, is_active 0 (so the list, refilter, evaluate, liveness and rank, which
 * all read active jobs only, never see it) and no excluded_reason. The same URL reuses its job, and a sweep job
 * whose apply/canonical URL is the form is reused too.
 */
import { getSqlite } from "@/lib/db/client";
import { companySlug } from "@/lib/pipeline/normalise";
import { requestRun, type RequestResult } from "./runs";

export const MANUAL_PREFIX = "manual|";

export function addManualJob(input: { url: string; company: string; title: string }, now = new Date().toISOString()): RequestResult & { jobId: number } {
  const db = getSqlite();
  const url = input.url.trim();
  return db.transaction(() => {
    let jobId = (db.prepare("select id from jobs where apply_url = ? or canonical_url = ? or dedupe_key = ? order by id limit 1")
      .get(url, url, MANUAL_PREFIX + url) as { id: number } | undefined)?.id;
    if (!jobId) {
      const name = input.company.trim();
      const slug = companySlug(name);
      const companyId = (db.prepare("select id from companies where slug = ?").get(slug) as { id: number } | undefined)?.id
        ?? Number(db.prepare("insert into companies (slug, name) values (?, ?)").run(slug, name).lastInsertRowid);
      jobId = Number(db.prepare(
        "insert into jobs (company_id, title, kind, apply_url, is_active, excluded_reason, dedupe_key, first_seen, last_seen) values (?,?,'unknown',?,0,null,?,?,?)",
      ).run(companyId, input.title.trim(), url, MANUAL_PREFIX + url, now, now).lastInsertRowid);
    }
    return { jobId, ...requestRun(jobId, "apply", now, { formUrl: url }) };
  })();
}
