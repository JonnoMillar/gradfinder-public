/**
 * Assessment prep hub (`/prep`, Jonno 2026-11-04): one file per role in the gitignored `profile/prep/<jobId>.json`,
 * validated here, read by the server pages. Sky (job 3951) is the first; the shape is the template for the rest.
 *
 * Every fact carries a kind so the page can label where it came from in words, never by colour alone:
 *   sky       = Sky's own pages (the posting, its published write-ups)
 *   reported  = third parties: TargetJobs, candidate reports, prep sites. Useful, not Sky's word.
 *   technique = general test advice, no source.
 * The pipeline never writes here; Claude sessions write the JSON from sourced research and the confirmed store.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getSqlite } from "@/lib/db/client";
import { PROFILE } from "@/lib/kit";

const Kind = z.enum(["sky", "reported", "technique"]);
const Fact = z.object({ kind: Kind, text: z.string(), url: z.string().url().optional() });
const Block = z.object({ facts: z.array(Fact), approach: z.array(z.string()), checklist: z.array(z.string()) });

export const Question = z.object({
  q: z.string(),
  from: z.string(),
  /** ready = every fact is in the store; partial = one gap Jonno must fill; gap = no usable story yet */
  status: z.enum(["ready", "partial", "gap"]),
  chain: z.array(z.string()),
  evidence: z.string(),
  value: z.string().optional(),
  gap: z.string().optional(),
});
export type Question = z.infer<typeof Question>;

export const PrepFile = z.object({
  jobId: z.number(),
  updated: z.string(),
  headline: z.string(),
  start: z.object({
    steps: z.array(z.object({ title: z.string(), when: z.string(), note: z.string() })),
    rules: z.array(z.string()),
    unknowns: z.array(z.string()),
  }),
  valuesIntro: z.string(),
  values: z.array(z.object({
    name: z.string(), says: z.string(), meaning: z.string(), evidence: z.array(z.string()), wording: z.array(z.string()),
  })),
  programmeSkills: z.array(z.string()),
  behavioural: Block,
  reasoning: Block,
  hirevue: z.object({
    facts: z.array(Fact), setup: z.array(z.string()), method: z.array(z.string()), pitfalls: z.array(z.string()),
    questions: z.array(Question),
  }),
  sources: z.array(z.object({ label: z.string(), url: z.string().url().nullable() })),
});
export type PrepFile = z.infer<typeof PrepFile>;

const dir = () => path.join(PROFILE(), "prep");

export interface PrepRole {
  jobId: number; company: string; companySlug: string; logoUrl: string | null; domain: string | null;
  title: string; status: string | null; deadline: string | null;
  /** the open ask from the employer's latest email (Gmail sync), e.g. "Complete the Sky digital assessment" */
  due: string | null; dueText: string | null;
}

const OPEN_ASK = (col: string) => `(select e.${col} from email_updates e where e.application_id = a.id and e.action_done = 0
  and e.action_due is not null order by e.id desc limit 1)`;
const ROLE_SQL = `
  select j.id as jobId, c.name as company, c.slug as companySlug, c.logo_url as logoUrl, c.domain, j.title,
         a.status, j.deadline, ${OPEN_ASK("action_due")} as due, ${OPEN_ASK("action_text")} as dueText
  from jobs j join companies c on c.id = j.company_id left join applications a on a.job_id = j.id`;

/** The prep file for a role, or null when there is none (or it fails validation: the page then says so). */
export function prepFor(jobId: number): { prep: PrepFile; role: PrepRole } | { error: string } | null {
  let raw: string;
  try { raw = fs.readFileSync(path.join(dir(), `${jobId}.json`), "utf8"); } catch { return null; }
  const parsed = PrepFile.safeParse(JSON.parse(raw));
  if (!parsed.success) return { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const role = getSqlite().prepare(`${ROLE_SQL} where j.id = ?`).get(jobId) as PrepRole | undefined;
  return role ? { prep: parsed.data, role } : null;
}

export const hasPrep = (jobId: number) => fs.existsSync(path.join(dir(), `${jobId}.json`));

/** Every role that has a prep file, with its stage, for the `/prep` index. */
export function listPrep(): PrepRole[] {
  let files: string[] = [];
  try { files = fs.readdirSync(dir()); } catch { return []; }
  const ids = files.map((f) => /^(\d+)\.json$/.exec(f)?.[1]).filter((x): x is string => !!x).map(Number);
  const sql = getSqlite().prepare(`${ROLE_SQL} where j.id = ?`);
  return ids.map((id) => sql.get(id) as PrepRole | undefined).filter((r): r is PrepRole => !!r);
}
