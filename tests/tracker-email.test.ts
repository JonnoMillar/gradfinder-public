/**
 * Gmail → tracker, against a throwaway DB. The emails are the real shapes of a bank's first two emails
 * (2026-09-22): "We've received your application" and "Invitation to complete an online assessment".
 */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gradfinder-track-"));
process.env.DB_PATH = path.join(tmp, "test.db");

const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
const { getDb, getSqlite } = await import("@/lib/db/client");
const { nextStatus, recordEmailUpdate } = await import("@/lib/tracker/email");

const db = () => getSqlite();
let northQuant = 0, northTech = 0, edf = 0, untrackedJob = 0;

function job(companyId: number, title: string, key: string) {
  return Number(db().prepare("insert into jobs (company_id, title, dedupe_key) values (?,?,?)").run(companyId, title, key).lastInsertRowid);
}
function track(jobId: number, status: string) {
  return Number(db().prepare("insert into applications (job_id, status) values (?,?)").run(jobId, status).lastInsertRowid);
}
const email = (over: Record<string, unknown>) => ({
  gmailMessageId: `m${Math.random()}`, receivedAt: "2026-09-22T23:39:37Z", sender: "graduates@northwind.example",
  subject: "Invitation to complete an online assessment", kind: "assessment_invite", company: "Northwind", ...over,
});
const statusOf = (appId: number) => (db().prepare("select status from applications where id = ?").get(appId) as { status: string }).status;

beforeAll(() => {
  migrate(getDb(), { migrationsFolder: path.resolve("lib/db/migrations") });
  const b = Number(db().prepare("insert into companies (slug, name) values ('northwind','Northwind')").run().lastInsertRowid);
  const e = Number(db().prepare("insert into companies (slug, name) values ('edf','EDF UK')").run().lastInsertRowid);
  northQuant = track(job(b, "Risk Analytics Graduate Programme 2027", "b1"), "applied");
  edf = track(job(e, "Data & Technology Graduate 2027", "e1"), "interested");
  untrackedJob = job(e, "Commercial Graduate 2027", "e2");
  northTech = 0;
});

describe("nextStatus", () => {
  it("moves forward only", () => {
    expect(nextStatus("applied", "assessment_invite")).toBe("tests");
    expect(nextStatus("interested", "received")).toBe("applied");
    expect(nextStatus("interview", "assessment_invite")).toBeNull();   // a late test invite never moves you back
    expect(nextStatus("tests", "received")).toBeNull();
  });
  it("tests done sits between tests and interview", () => {
    expect(nextStatus("tests_done", "assessment_invite")).toBeNull();
    expect(nextStatus("tests_done", "interview_invite")).toBe("interview");
    expect(nextStatus("tests_done", "rejection")).toBe("rejected");
  });
  it("a HireVue invite lands on the HireVue stage, after tests and before interview", () => {
    expect(nextStatus("applied", "assessment_invite", "Complete the Fabrikam HireVue pre-interview")).toBe("hirevue");
    expect(nextStatus("tests_done", "assessment_invite", "Your video interview invitation")).toBe("hirevue");
    expect(nextStatus("tests", "assessment_invite", "Online numerical test")).toBeNull();
    expect(nextStatus("hirevue", "assessment_invite", "Complete the SHL test")).toBeNull();   // never back to tests
    expect(nextStatus("hirevue", "interview_invite")).toBe("interview");
    expect(nextStatus("interview", "assessment_invite", "HireVue")).toBeNull();
  });

  it("a ticked HireVue or interview waits; a new interview invite re-opens the interview step (next round)", () => {
    expect(nextStatus("hirevue_done", "assessment_invite", "HireVue reminder")).toBeNull();
    expect(nextStatus("hirevue_done", "interview_invite")).toBe("interview");
    expect(nextStatus("interview_done", "interview_invite")).toBe("interview");
    expect(nextStatus("interview_done", "assessment_invite", "Online test")).toBeNull();
    expect(nextStatus("interview_done", "offer")).toBe("offer");
    expect(nextStatus("hirevue_done", "rejection")).toBe("rejected");
  });
  it("rejection ends anything short of an offer; dismissed is Jonno's and never touched", () => {
    expect(nextStatus("tests", "rejection")).toBe("rejected");
    expect(nextStatus("offer", "rejection")).toBeNull();
    expect(nextStatus("dismissed", "interview_invite")).toBeNull();
    expect(nextStatus("rejected", "interview_invite")).toBeNull();
    expect(nextStatus("closed", "received")).toBeNull();          // Jonno archived it: the employer closed the process
    expect(nextStatus("closed", "rejection")).toBeNull();
  });
  it("informational emails move nothing", () => {
    expect(nextStatus("applied", "other")).toBeNull();
    expect(nextStatus("applied", "action_required")).toBeNull();
  });
});

describe("recordEmailUpdate", () => {
  it("moves the only tracked Northwind role to tests and logs where it came from", () => {
    const r = recordEmailUpdate(email({ gmailMessageId: "msg-0001", actionText: "Complete the online assessment", actionDue: "2026-09-29" }));
    expect(r).toMatchObject({ result: "recorded", applicationId: northQuant, statusFrom: "applied", statusTo: "tests" });
    expect(statusOf(northQuant)).toBe("tests");
    const log = db().prepare("select note from activity_log where application_id = ?").get(northQuant) as { note: string };
    expect(log.note).toContain("Gmail: Invitation to complete an online assessment");
  });
  it("is idempotent: the same message twice changes nothing", () => {
    expect(recordEmailUpdate(email({ gmailMessageId: "msg-0001" }))).toEqual({ gmailMessageId: "msg-0001", result: "duplicate" });
  });
  it("an older 'received' email arriving after the test invite does not move it back", () => {
    const r = recordEmailUpdate(email({ gmailMessageId: "msg-0002", kind: "received", subject: "Northwind: We've received your application!" }));
    expect(r).toMatchObject({ result: "recorded", applicationId: northQuant });
    expect(r).not.toHaveProperty("statusTo", expect.anything());
    expect(statusOf(northQuant)).toBe("tests");
  });
  it("never overwrites Jonno's next action — the email's action lives on the email row", () => {
    db().prepare("update applications set next_action = 'my own plan' where id = ?").run(edf);
    recordEmailUpdate(email({ company: "EDF", sender: "x@edf.com", kind: "action_required", actionText: "Upload transcript", role: "Data & Technology" }));
    expect((db().prepare("select next_action from applications where id = ?").get(edf) as { next_action: string }).next_action).toBe("my own plan");
    expect(db().prepare("select count(*) n from email_updates where action_text = 'Upload transcript' and application_id = ?").get(edf)).toEqual({ n: 1 });
  });
  it("two tracked roles at one company: the role words pick one, a tie links nothing", () => {
    const b = (db().prepare("select id from companies where slug='northwind'").get() as { id: number }).id;
    northTech = track(job(b, "Technology Graduate Programme 2027", "b2"), "applied");
    expect(recordEmailUpdate(email({ kind: "interview_invite", role: "2027 Technology Graduate" }))).toMatchObject({ applicationId: northTech, statusTo: "interview" });
    expect(recordEmailUpdate(email({ kind: "other", role: null, subject: "Northwind newsletter" }))).toMatchObject({ applicationId: null });
  });
  it("a company with nothing tracked is stored unlinked, not guessed", () => {
    expect(recordEmailUpdate(email({ company: "Contoso", sender: "noreply@tal.net", kind: "received" }))).toMatchObject({ result: "recorded", applicationId: null });
  });
  it("a 'received' email naming a listed but untracked job starts tracking it as applied", () => {
    const r = recordEmailUpdate(email({ company: "EDF", jobId: untrackedJob, kind: "received" }));
    expect(r).toMatchObject({ result: "recorded", statusTo: "applied" });
    expect(db().prepare("select status, applied_at from applications where job_id = ?").get(untrackedJob)).toEqual({ status: "applied", applied_at: "2026-09-22T23:39:37Z" });
  });
  it("an application run moves a role to applying/applied, forward only, creating it on first touch", async () => {
    const { automationStatus } = await import("@/lib/tracker/email");
    const e = (db().prepare("select id from companies where slug='edf'").get() as { id: number }).id;
    const fresh = job(e, "Finance Graduate 2027", "e3");
    expect(automationStatus(fresh, "applying", "run started")).toMatchObject({ status: "applying", moved: true });
    expect(automationStatus(fresh, "applied", "submitted")).toMatchObject({ status: "applied", moved: true });
    expect(automationStatus(fresh, "applying", "late restart")).toMatchObject({ status: "applied", moved: false });
    const northJob = (db().prepare("select job_id from applications where id = ?").get(northQuant) as { job_id: number }).job_id;
    expect(automationStatus(northJob, "applied", "x")).toMatchObject({ status: "tests", moved: false });
  });
  it("rejects malformed input instead of writing half a row", () => {
    expect(() => recordEmailUpdate({ gmailMessageId: "x", kind: "nonsense" })).toThrow();
  });
});

describe("employer's own role title", () => {
  it("picks the right application at a company with several tracked roles, using the title an apply run stored", () => {
    const c = Number(db().prepare("insert into companies (slug, name) values ('fabrikam','Fabrikam')").run().lastInsertRowid);
    const emea = track(job(c, "2027 Full-Time Analyst Program - EMEA", "br1"), "applied");
    const client = track(job(c, "Client and Product Graduate Rotational Program", "br2"), "applied");
    // The confirmation names a track that matches neither listing title by words...
    const mail = { company: "Fabrikam", sender: "noreply@tal.net", kind: "other", role: "Technology - Data & Insights - London", subject: "Application Update" };
    expect(recordEmailUpdate(email(mail))).toMatchObject({ applicationId: null });
    // ...until an apply run stores the employer's own title on the application.
    db().prepare("update applications set employer_title = ? where id = ?").run("2027 Full-Time Analyst Program - Technology - Data & Insights - London", emea);
    expect(recordEmailUpdate(email(mail))).toMatchObject({ applicationId: emea, matchedBy: "company + role words" });
    expect(client).not.toBe(emea);
  });
  it("an email about another track at the same company is not linked, even when that company has one application", () => {
    // A backup-track choice opened a Software Engineering application that was never finished; its reminders
    // (and eventual rejection) must not land on the Data & Insights application.
    const c = Number(db().prepare("insert into companies (slug, name) values ('rockbank','Rockbank')").run().lastInsertRowid);
    const am = track(job(c, "2027 Full-Time Analyst Program - EMEA", "brx1"), "hirevue");
    db().prepare("update applications set employer_title = ? where id = ?").run("2027 Full-Time Analyst Program - Technology - Data & Insights - London", am);
    const swe = { company: "Rockbank", kind: "rejection", role: "2027 Full-Time Analyst Program - Technology - Software Engineering - London" };
    expect(recordEmailUpdate(email(swe))).toMatchObject({ applicationId: null });
    expect(statusOf(am)).toBe("hirevue");
    // the same track, worded a little differently, or no role at all, still links
    expect(recordEmailUpdate(email({ company: "Rockbank", kind: "other", role: "Technology - Data and Insights - London" }))).toMatchObject({ applicationId: am });
    expect(recordEmailUpdate(email({ company: "Rockbank", kind: "other", subject: "Rockbank | Update" }))).toMatchObject({ applicationId: am });
  });
});
