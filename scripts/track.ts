/**
 * npm run track — the tracker's command line, used by the Gmail sync (a Claude scheduled task) and by hand.
 *
 *   npm run track -- context               what's tracked + the newest email already recorded (JSON)
 *   npm run track -- find "<company>"      that company's jobs in the DB, to pass a jobId (JSON)
 *   npm run track -- record <file.json>    record emails: a JSON array of EmailUpdateInput (lib/tracker/email.ts)
 *   npm run track -- draft <file.json>     add drafted answers: a JSON array of DraftInput (lib/apply/answers.ts)
 *   npm run track -- answers <appId>       the APPROVED answers for a form, as JSON (the form-filler reads this)
 *   npm run track -- submitted <appId>     after the form is submitted: approved answers → submitted
 *   npm run track -- start <jobId>         an application run began: → applying (forward only)
 *   npm run track -- applied <jobId>       Jonno submitted the form: → applied (forward only)
 *
 * `record` takes a file, not an argument, so subjects with quotes and pipes survive Windows shells.
 */
import fs from "node:fs";
import { getSqlite } from "../lib/db/client";
import { automationStatus, recordEmailUpdate, trackerContext } from "../lib/tracker/email";
import { listAnswers, markSubmitted, upsertDraft } from "../lib/apply/answers";

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "context") return console.log(JSON.stringify(trackerContext(), null, 2));
  if (cmd === "find") {
    if (!arg) throw new Error('usage: track find "<company>"');
    const rows = getSqlite().prepare(`
      select j.id as jobId, c.name as company, j.title, j.is_active as active, j.excluded_reason as excluded,
             a.id as applicationId, a.status
      from jobs j join companies c on c.id = j.company_id left join applications a on a.job_id = j.id
      where c.name like ? order by j.is_active desc, j.title`).all(`%${arg}%`);
    return console.log(JSON.stringify(rows, null, 2));
  }
  if (cmd === "record") {
    if (!arg) throw new Error("usage: track record <file.json>");
    const items = JSON.parse(fs.readFileSync(arg, "utf8")) as unknown[];
    if (!Array.isArray(items)) throw new Error("record expects a JSON array");
    let failed = 0;
    for (const it of items) {
      try { console.log(JSON.stringify(recordEmailUpdate(it))); }
      catch (e) { failed++; console.log(JSON.stringify({ error: e instanceof Error ? e.message : String(e), item: (it as { gmailMessageId?: string })?.gmailMessageId })); }
    }
    if (failed) process.exitCode = 1;
    return;
  }
  if (cmd === "draft") {
    if (!arg) throw new Error("usage: track draft <file.json>");
    const items = JSON.parse(fs.readFileSync(arg, "utf8")) as unknown[];
    if (!Array.isArray(items)) throw new Error("draft expects a JSON array");
    for (const it of items) {
      try { console.log(JSON.stringify(upsertDraft(it))); }
      catch (e) { process.exitCode = 1; console.log(JSON.stringify({ error: e instanceof Error ? e.message : String(e) })); }
    }
    return;
  }
  if (cmd === "start" || cmd === "applied") {
    const id = Number(arg);
    if (!Number.isInteger(id) || id <= 0) throw new Error(`usage: track ${cmd} <jobId>`);
    const to = cmd === "start" ? "applying" : "applied";
    return console.log(JSON.stringify(automationStatus(id, to, cmd === "start" ? "Application run started" : "Submitted (application run)")));
  }
  if (cmd === "answers" || cmd === "submitted") {
    const id = Number(arg);
    if (!Number.isInteger(id) || id <= 0) throw new Error(`usage: track ${cmd} <applicationId>`);
    if (cmd === "submitted") return console.log(`${markSubmitted(id)} approved answers marked submitted`);
    return console.log(JSON.stringify(listAnswers(id, "approved").map((a) => ({ question: a.question, text: a.text })), null, 2));
  }
  throw new Error("usage: track context | find <company> | record <file.json> | draft <file.json> | answers <appId> | submitted <appId>");
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
