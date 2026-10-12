/**
 * Drafted free-text answers and their approval state (table `application_answers`).
 *
 *   draft ──(Jonno edits/approves on the role page)──▶ approved ──(form-filler types it in)──▶ submitted
 *
 * - A drafting run may replace a DRAFT for the same question; it can never touch an approved or submitted answer.
 * - Any edit Jonno makes returns an answer to draft until he approves that exact text.
 * - The form-filler only ever reads approved answers.
 */
import { z } from "zod";
import { getSqlite } from "@/lib/db/client";
import type { AnswerStatus } from "@/lib/db/schema";

export const DraftInput = z.object({
  applicationId: z.number().int().positive(),
  question: z.string().trim().min(3).max(2000),
  text: z.string().trim().min(1).max(20_000),
  wordLimit: z.number().int().positive().nullish(),
  charLimit: z.number().int().positive().nullish(),
  gaps: z.array(z.string()).default([]),
  sources: z.array(z.string()).default([]),
});

export interface AnswerRow {
  id: number; applicationId: number; question: string; text: string; status: AnswerStatus;
  wordLimit: number | null; charLimit: number | null; gaps: string[]; sources: string[]; updatedAt: string;
}

export const wordCount = (s: string) => (s.trim().match(/\S+/g) ?? []).length;

/** Over a stated limit? Returns a human reason or null. */
export function overLimit(a: { text: string; wordLimit?: number | null; charLimit?: number | null }): string | null {
  if (a.wordLimit && wordCount(a.text) > a.wordLimit) return `${wordCount(a.text)} words, limit ${a.wordLimit}`;
  if (a.charLimit && a.text.length > a.charLimit) return `${a.text.length} characters, limit ${a.charLimit}`;
  return null;
}

const toRow = (r: Record<string, unknown>): AnswerRow => ({
  id: Number(r.id), applicationId: Number(r.application_id), question: String(r.question), text: String(r.text),
  status: r.status as AnswerStatus, wordLimit: r.word_limit == null ? null : Number(r.word_limit),
  charLimit: r.char_limit == null ? null : Number(r.char_limit),
  gaps: JSON.parse(String(r.gaps ?? "[]")), sources: JSON.parse(String(r.sources ?? "[]")), updatedAt: String(r.updated_at),
});

export function listAnswers(applicationId: number, status?: AnswerStatus): AnswerRow[] {
  const db = getSqlite();
  const rows = status
    ? db.prepare("select * from application_answers where application_id = ? and status = ? order by id").all(applicationId, status)
    : db.prepare("select * from application_answers where application_id = ? order by id").all(applicationId);
  return (rows as Record<string, unknown>[]).map(toRow);
}

export type DraftOutcome = { question: string; result: "inserted" | "replaced_draft" | "kept_existing"; status?: AnswerStatus; over?: string };

export function upsertDraft(raw: unknown, now = new Date().toISOString()): DraftOutcome {
  const d = DraftInput.parse(raw);
  const db = getSqlite();
  if (!db.prepare("select 1 from applications where id = ?").get(d.applicationId)) throw new Error(`No application ${d.applicationId}`);
  const over = overLimit(d) ?? undefined;
  const existing = db.prepare("select id, status from application_answers where application_id = ? and question = ?")
    .get(d.applicationId, d.question) as { id: number; status: AnswerStatus } | undefined;
  if (existing && existing.status !== "draft") return { question: d.question, result: "kept_existing", status: existing.status };
  if (existing) {
    db.prepare("update application_answers set text=?, word_limit=?, char_limit=?, gaps=?, sources=?, updated_at=? where id=?")
      .run(d.text, d.wordLimit ?? null, d.charLimit ?? null, JSON.stringify(d.gaps), JSON.stringify(d.sources), now, existing.id);
    return { question: d.question, result: "replaced_draft", over };
  }
  db.prepare(`insert into application_answers (application_id, question, text, word_limit, char_limit, gaps, sources, created_at, updated_at)
              values (?,?,?,?,?,?,?,?,?)`)
    .run(d.applicationId, d.question, d.text, d.wordLimit ?? null, d.charLimit ?? null, JSON.stringify(d.gaps), JSON.stringify(d.sources), now, now);
  return { question: d.question, result: "inserted", over };
}

/** Jonno's edit (status back to draft) or approval (status approved) of exactly this text. Submitted is final. */
export function reviewAnswer(id: number, text: string, approve: boolean, now = new Date().toISOString()): AnswerRow {
  const db = getSqlite();
  const cur = db.prepare("select * from application_answers where id = ?").get(id) as Record<string, unknown> | undefined;
  if (!cur) throw new Error(`No answer ${id}`);
  if (cur.status === "submitted") throw new Error("Already submitted: it can no longer be changed");
  const t = text.trim();
  if (!t) throw new Error("An answer can't be empty");
  if (approve) {
    const over = overLimit({ text: t, wordLimit: cur.word_limit as number | null, charLimit: cur.char_limit as number | null });
    if (over) throw new Error(`Over the limit (${over})`);
    if (/\[ASK:/i.test(t)) throw new Error("It still contains an [ASK: …] gap");
  }
  db.prepare("update application_answers set text = ?, status = ?, updated_at = ? where id = ?").run(t, approve ? "approved" : "draft", now, id);
  return toRow(db.prepare("select * from application_answers where id = ?").get(id) as Record<string, unknown>);
}

/** The form-filler calls this after typing approved answers into a submitted form. Returns how many moved. */
export function markSubmitted(applicationId: number, now = new Date().toISOString()): number {
  return getSqlite().prepare("update application_answers set status = 'submitted', updated_at = ? where application_id = ? and status = 'approved'")
    .run(now, applicationId).changes;
}
