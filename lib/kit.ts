/**
 * Reads (and the few writes) for the `/kit` page: what Claude will actually use when it applies. The files live in the
 * gitignored `profile/`. Writes are Jonno's own answers from the page: a questions.md item ticked with his answer under
 * it, and the base letter's Status line. Everything else is edited in Word or by a Claude session.
 */
import fs from "node:fs";
import path from "node:path";
import { getSqlite } from "@/lib/db/client";
import { USER } from "@/config/user";

/** The knowledge store. `PROFILE_DIR` points it elsewhere: demo mode uses the committed, fictional `demo/profile`. */
export const PROFILE = () => path.resolve(process.cwd(), process.env.PROFILE_DIR ?? "profile");
export const CV_DIR = () => path.join(PROFILE(), "cv");
/** The file every Apply run uploads (lib/runs/launch.ts). */
export const CURRENT_CV = process.env.CV_FILE ?? USER.cvFile;
const QUESTIONS = () => path.join(PROFILE(), "questions.md");
const LETTERS = () => path.join(PROFILE(), "cover-letters");

const read = (p: string) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };
const list = (dir: string) => { try { return fs.readdirSync(dir); } catch { return []; } };
/** Markdown escapes and backticks off: `\[ASK\]` → `[ASK]`, `` `ideaflow` `` → `ideaflow`. */
const clean = (s: string) => s.replace(/\\([[\]*_`])/g, "$1").replace(/`/g, "");
const today = (now = new Date()) => now.toISOString().slice(0, 10);

/** Page objects in a PDF. Word's exports write one `/Type /Page` per page (`/Pages` is the tree, excluded). */
export function pdfPages(buf: Buffer): number {
  return (buf.toString("latin1").match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
}

export interface KitCv { file: string; pages: number; current: boolean; modified: string }
export function cvFiles(): KitCv[] {
  return list(CV_DIR()).filter((f) => /\.pdf$/i.test(f)).map((file) => {
    const p = path.join(CV_DIR(), file);
    return { file, pages: pdfPages(fs.readFileSync(p)), current: file === CURRENT_CV, modified: fs.statSync(p).mtime.toISOString() };
  }).sort((a, b) => Number(b.current) - Number(a.current) || a.file.localeCompare(b.file));
}

// ---- base cover letter

export interface KitPiece { code: string; label: string; text: string; isDefault: boolean }
export interface KitPieceGroup { heading: string; hint: string; items: KitPiece[] }
export interface KitLetter { file: string; approved: boolean; letter: string[]; pieces: KitPieceGroup[] }

/** Markdown with hard-wrapped lines → paragraphs (blank-line separated, inner newlines joined). */
const paras = (md: string) => md.split(/\r?\n\s*\r?\n/).map((p) => p.replace(/\s*\r?\n\s*/g, " ").trim()).filter(Boolean);
const newestLetter = () => list(LETTERS()).filter((f) => /^base-.*\.md$/.test(f)).sort().pop();

/** The newest `cover-letters/base-*.md`: the letter, whether Jonno approved it, and the pieces runs swap in. */
export function baseLetter(): KitLetter | null {
  const file = newestLetter();
  const text = file ? read(path.join(LETTERS(), file)) : null;
  if (!file || text == null) return null;
  // The letter sits between the first two `---` rules; the swap-in pieces come after.
  const parts = text.split(/^---\s*$/m);
  const approved = /^Status:\s*\[?CONFIRMED/m.test(text);
  return parts.length >= 3
    ? { file, approved, letter: paras(parts[1]), pieces: parsePieces(parts.slice(2).join("\n")) }
    : { file, approved, letter: paras(text), pieces: [] };
}

/**
 * The `## His reason (…)` and `## Evidence blocks (…)` sections: `- **R1, label:** text` bullets, wrapped lines joined.
 * The trailing source note "(S1 [CONFIRMED]; never …)" is Claude's bookkeeping and is dropped; other sections
 * (the self-check) are instructions for runs, not for Jonno, and are skipped.
 */
export function parsePieces(md: string): KitPieceGroup[] {
  const groups: KitPieceGroup[] = [];
  let g: KitPieceGroup | null = null;
  let cur: { head: RegExpMatchArray; body: string } | null = null;
  const flush = () => {
    if (!g || !cur) return;
    const [, code, label, rest] = cur.head;
    const body = `${rest}${cur.body}`.trim();
    const isDefault = /^\(default/i.test(body);
    const textOnly = isDefault ? "" : body.replace(/\s*\([^()]*(\[|\bS\d|facts\.yaml|stories)[^()]*\)\.?\s*$/, "").trim();
    g.items.push({ code, label: label.trim(), text: textOnly, isDefault });
    cur = null;
  };
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+?)(?:\s*\((.+)\))?\s*$/);
    if (h) {
      flush();
      g = /reason|evidence/i.test(h[1]) ? { heading: h[1].replace(/^His\b/, "Your"), hint: h[2] ?? "", items: [] } : null;
      if (g) groups.push(g);
      continue;
    }
    const b = line.match(/^- \*\*([A-Z]\d+),\s*([^*]+?):?\*\*\s*(.*)$/);
    if (b) { flush(); cur = { head: b, body: "" }; continue; }
    if (cur && /^\s+\S/.test(line)) cur.body += ` ${line.trim()}`;
    else if (cur && !line.trim()) flush();
  }
  flush();
  return groups.filter((x) => x.items.length);
}

export { letterSlots } from "@/lib/kit-slots";

/** Jonno approves (or un-approves) the base letter from the Kit page: rewrites its `Status:` line only. */
export function setLetterApproved(approve: boolean, now = new Date()): void {
  const file = newestLetter();
  if (!file) throw new Error("No base letter");
  const p = path.join(LETTERS(), file);
  const text = read(p) ?? "";
  const line = approve ? `Status: [CONFIRMED]. Approved by ${USER.name} on the Kit page, ${today(now)}.` : "Status: [DRAFT]. Not approved.";
  if (!/^Status:.*$/m.test(text)) throw new Error("The letter has no Status line");
  fs.writeFileSync(p, text.replace(/^Status:.*$/m, line));
}

// ---- answer bank (DB)

export interface KitAnswer { id: number; jobId: number; company: string; role: string; question: string; status: string; text: string; words: number }
/** Every drafted, approved or submitted answer: the bank the Apply run reuses. */
export function answerBank(): KitAnswer[] {
  const rows = getSqlite().prepare(`select aa.id, j.id as jobId, c.name as company, j.title as role, aa.question, aa.status, aa.text
    from application_answers aa join applications a on a.id = aa.application_id join jobs j on j.id = a.job_id
    join companies c on c.id = j.company_id order by aa.updated_at desc`).all() as Omit<KitAnswer, "words">[];
  return rows.map((r) => ({ ...r, words: (r.text.match(/\S+/g) ?? []).length }));
}

export interface KitInboxItem { file: string; lines: number; modified: string }
/** Raw imports waiting for a merge session (archive/ excluded). */
export function inbox(): KitInboxItem[] {
  const dir = path.join(PROFILE(), "inbox");
  return list(dir).filter((f) => /\.md$/i.test(f)).map((file) => {
    const p = path.join(dir, file);
    return { file, lines: (read(p) ?? "").split("\n").length, modified: fs.statSync(p).mtime.toISOString() };
  });
}

// ---- open questions (profile/questions.md)

export interface KitGapItem { raw: string; title: string; detail: string; why?: string; todo?: string; link?: string; options?: string[] }
export interface KitGapGroup { heading: string; why?: string; items: KitGapItem[]; done: number }

export const openGaps = (): KitGapGroup[] => parseGaps(read(QUESTIONS()) ?? "");
/**
 * Unticked `- [ ]` items under their nearest heading or bold label, with how many `- [x]` are settled there. A `why:`
 * line under a heading explains the group; `- why:` / `- do:` / `- link:` / `- options: a | b` under an item add the
 * explanation, the place to do it and one-click answers. `raw` is the item text exactly as in the file (for writes).
 */
export function parseGaps(text: string): KitGapGroup[] {
  const groups: KitGapGroup[] = [];
  const whyFor = new Map<string, string>();
  let heading = "Open questions";
  let last: KitGapItem | null = null;
  const group = () => groups.find((x) => x.heading === heading) ?? groups[groups.push({ heading, why: whyFor.get(heading), items: [], done: 0 }) - 1];
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^#{2,4}\s+(.+)/) ?? line.match(/^\*\*(.+)\*\*\s*$/);
    if (h) { heading = h[1]; last = null; continue; }
    const gw = line.match(/^why:\s*(.+)/);
    if (gw) { whyFor.set(heading, gw[1].trim()); continue; }
    const item = line.match(/^\s*- \[( |x)\]\s+(.+)/i);
    if (item) {
      const g = group();
      if (item[1] !== " ") { g.done++; last = null; continue; }
      last = { raw: item[2], ...splitGap(clean(item[2])) };
      g.items.push(last);
      continue;
    }
    const sub = last && line.match(/^\s+- (why|do|link|options):\s*(.+)/);
    if (sub && last) {
      const v = clean(sub[2].trim());
      if (sub[1] === "why") last.why = v;
      else if (sub[1] === "do") last.todo = v;
      else if (sub[1] === "link") last.link = v;
      else last.options = v.split(/\s+\|\s+/).filter(Boolean);
    }
  }
  return groups.map((g) => ({ ...g, why: g.why ?? whyFor.get(g.heading) })).filter((g) => g.items.length);
}

/** "Middle names: how should they appear?" → title + detail, so a list of questions scans by its first words. */
export function splitGap(s: string): { title: string; detail: string } {
  const colon = s.indexOf(": ");
  if (colon > 0 && colon <= 48) return { title: s.slice(0, colon), detail: s.slice(colon + 2) };
  const q = s.indexOf("? ");
  if (q > 0) return { title: s.slice(0, q + 1), detail: s.slice(q + 2) };
  return { title: s, detail: "" };
}

const answerLine = (answer: string, now: Date) =>
  `  - answer [CONFIRMED] (${USER.name} via Kit, ${today(now)}): ${answer.replace(/\s*\r?\n\s*/g, " / ").trim()}`;

/**
 * Jonno answered an open question on the Kit page: tick it and put his answer under it, labelled [CONFIRMED] (his own
 * words). A Claude session later moves it into facts.yaml / stories.md. Pure text in, text out, so it's testable.
 */
export function withAnswer(md: string, raw: string, answer: string, now = new Date()): string {
  const eol = md.includes("\r\n") ? "\r\n" : "\n";
  const lines = md.split(/\r?\n/);
  const i = lines.findIndex((l) => /^\s*- \[ \]\s+/.test(l) && l.replace(/^\s*- \[ \]\s+/, "") === raw);
  if (i < 0) throw new Error("That question has changed since the page loaded. Reload and try again.");
  lines[i] = lines[i].replace("- [ ]", "- [x]");
  let j = i + 1;
  while (j < lines.length && /^\s+- /.test(lines[j])) j++;
  lines.splice(j, 0, answerLine(answer, now));
  return lines.join(eol);
}

/** Undo of withAnswer: untick the item and drop the answer line it added. */
export function withoutAnswer(md: string, raw: string, answer: string): string {
  const eol = md.includes("\r\n") ? "\r\n" : "\n";
  const lines = md.split(/\r?\n/);
  const i = lines.findIndex((l) => /^\s*- \[x\]\s+/i.test(l) && l.replace(/^\s*- \[x\]\s+/i, "") === raw);
  if (i < 0) throw new Error("Couldn't find that answer to undo.");
  lines[i] = lines[i].replace(/- \[x\]/i, "- [ ]");
  const tail = answerLine(answer, new Date()).replace(/^.*?\): /, "): ");
  let j = i + 1;
  while (j < lines.length && /^\s+- /.test(lines[j])) {
    if (lines[j].startsWith(`  - answer [CONFIRMED] (${USER.name} via Kit, `) && lines[j].endsWith(tail)) { lines.splice(j, 1); break; }
    j++;
  }
  return lines.join(eol);
}

export function answerGap(raw: string, answer: string): void {
  fs.writeFileSync(QUESTIONS(), withAnswer(read(QUESTIONS()) ?? "", raw, answer));
}
export function unanswerGap(raw: string, answer: string): void {
  fs.writeFileSync(QUESTIONS(), withoutAnswer(read(QUESTIONS()) ?? "", raw, answer));
}

// ---- interview cards (profile/answers/interview-cards.md)

/** One STAR step on the card's cue-word view: a trigger word or two, plus an optional small hint. */
export interface KitCue { step: "S" | "T" | "A" | "R"; word: string; hint: string }
export interface KitCard { question: string; type: string; status: "gap" | "partial" | null; source: string; story: string; bullets: string[]; notes: string[]; cues: KitCue[] }
export const interviewCards = (): KitCard[] => parseCards(read(path.join(PROFILE(), "answers", "interview-cards.md")) ?? "");
/** `## Question` blocks with `Type:` / `Status:` / `Source:` / `Story:` (its short title) / `Note:` lines, `S:`/`T:`/`A:`/`R:` cue lines
 *  (`word | hint`) and `- ` bullets. */
export function parseCards(md: string): KitCard[] {
  return md.split(/^## /m).slice(1).map((block) => {
    const [question, ...lines] = block.split(/\r?\n/);
    const card: KitCard = { question: question.trim(), type: "", status: null, source: "", story: "", bullets: [], notes: [], cues: [] };
    for (const l of lines) {
      const cue = l.match(/^([STAR]):\s*([^|]+?)\s*(?:\|\s*(.*?)\s*)?$/);
      if (cue) { card.cues.push({ step: cue[1] as KitCue["step"], word: cue[2], hint: cue[3] ?? "" }); continue; }
      const kv = l.match(/^(Type|Status|Source|Story|Note):\s*(.+)/);
      if (kv?.[1] === "Type") card.type = kv[2].trim();
      else if (kv?.[1] === "Status") card.status = /gap/i.test(kv[2]) ? "gap" : /partial/i.test(kv[2]) ? "partial" : null;
      else if (kv?.[1] === "Source") card.source = kv[2].trim();
      else if (kv?.[1] === "Story") card.story = kv[2].trim();
      else if (kv?.[1] === "Note") card.notes.push(kv[2].trim());
      else if (/^- /.test(l)) card.bullets.push(l.slice(2).trim());
    }
    return card;
  }).filter((c) => c.question && c.bullets.length);
}
