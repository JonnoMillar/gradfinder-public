import { describe, expect, it } from "vitest";
import { attention, callFor, levelFor, whenLabel } from "@/lib/tracker/attention";
import type { ApplicationRow, EmailUpdateRow } from "@/lib/queries";
import { daysUntil } from "@/lib/ui/format";

const NOW = new Date("2026-09-27T10:00:00Z");

function app(over: Partial<ApplicationRow>): ApplicationRow {
  return {
    id: 1, jobId: 100, status: "interested", nextAction: null, nextActionDue: null, notes: null, appliedAt: null,
    dismissedReason: null, updatedAt: "2026-09-20T00:00:00Z", lastActivityAt: null, title: "Grad role", deadline: null,
    jobActive: true, excludedReason: null, company: "Acme", companySlug: "acme", logoUrl: null, domain: null, live: null,
    ...over,
  };
}

function email(over: Partial<EmailUpdateRow>): EmailUpdateRow {
  return {
    id: 1, applicationId: 1, receivedAt: "2026-09-22T00:00:00Z", sender: "hr@acme.com", subject: "Test", kind: "assessment_invite",
    summary: null, viewUrl: null, companyHint: null, statusApplied: null, actionText: "Do the test", actionDue: "2026-09-27",
    actionDone: false, company: "Acme", title: "Grad role", jobId: 100, ...over,
  };
}

describe("daysUntil", () => {
  it("counts calendar days: today is 0 and tomorrow is 1, whatever the hour", () => {
    expect(daysUntil("2026-09-27", NOW)).toBe(0);
    expect(daysUntil("2026-09-28", NOW)).toBe(1);
    expect(daysUntil("2026-09-26T09:00:00Z", NOW)).toBe(-1);
    expect(daysUntil("2026-10-01", new Date(2026, 8, 27, 23, 30))).toBe(4);
    expect(daysUntil("soon", NOW)).toBeNull();
  });
});

describe("levelFor / whenLabel", () => {
  it("today, tomorrow and late are all 'now'", () => {
    expect([-3, 0, 1].map(levelFor)).toEqual(["now", "now", "now"]);
    expect([2, 7, 8].map(levelFor)).toEqual(["soon", "soon", "later"]);
  });
  it("labels", () => {
    expect([-2, -1, 0, 1, 5].map(whenLabel)).toEqual(["2 days late", "1 day late", "Today", "Tomorrow", "5 days"]);
  });
});

describe("callFor", () => {
  it("flags a closed listing only before submitting", () => {
    const live = { status: "closed" as const, evidence: "vacancy expired", checkedAt: "2026-09-26" };
    expect(callFor(app({ live }), NOW)).toMatch(/closed: vacancy expired/);
    expect(callFor(app({ live, status: "tests" }), NOW)).toBeNull();
  });
  it("a passed deadline matters for applying, not for applied", () => {
    expect(callFor(app({ status: "applying", deadline: "2026-09-25" }), NOW)).toBe("Deadline has passed");
    expect(callFor(app({ status: "applied", deadline: "2026-09-25", excludedReason: "deadline_passed" }), NOW)).toBeNull();
  });
});

describe("attention", () => {
  it("orders by days, email before own step before deadline on the same day", () => {
    const a = app({ nextAction: "Prep", nextActionDue: "2026-09-27", deadline: "2026-09-27" });
    const { items } = attention([a], [email({})], NOW);
    expect(items.map((i) => i.kind)).toEqual(["email", "step", "deadline"]);
    expect(items.every((i) => i.level === "now" && i.days === 0)).toBe(true);
  });

  it("skips done emails, finished applications and deadlines once submitted", () => {
    const done = email({ id: 2, actionDone: true });
    const rejected = app({ id: 2, status: "rejected", nextAction: "x", nextActionDue: "2026-09-28" });
    const applied = app({ id: 3, status: "applied", deadline: "2026-10-01" });
    const { items } = attention([rejected, applied], [done, email({ id: 3, applicationId: 2 })], NOW);
    expect(items).toEqual([]);
  });

  it("reminders for one application collapse to the newest open ask", () => {
    const old = email({ id: 1, receivedAt: "2026-09-22T00:00:00Z", actionDue: "2026-09-28" });
    const copy = email({ id: 2, receivedAt: "2026-09-25T10:00:00Z", actionDue: "2026-10-02" });
    const twin = email({ id: 3, receivedAt: "2026-09-25T10:00:00Z", actionDue: "2026-10-02" });
    const other = email({ id: 4, applicationId: 2, actionDue: "2026-10-02" });
    const { items } = attention([app({}), app({ id: 2 })], [old, copy, twin, other], NOW);
    expect(items.map((i) => i.key).sort()).toEqual(["e3", "e4"]);
  });

  it("a closed listing becomes a call, not a countdown, but keeps Jonno's own step", () => {
    const a = app({
      deadline: "2026-10-01", nextAction: "Prep", nextActionDue: "2026-09-28",
      live: { status: "closed", evidence: "expired", checkedAt: "2026-09-26" },
    });
    const { items, calls } = attention([a], [], NOW);
    expect(items.map((i) => [i.kind, i.days, i.level])).toEqual([["step", 1, "now"]]);
    expect(calls).toHaveLength(1);
  });

  it("a role Jonno marked closed drops out entirely: no countdown, step or call", () => {
    const a = app({ status: "closed", deadline: "2026-10-01", nextAction: "Prep", nextActionDue: "2026-09-28",
      live: { status: "closed", evidence: "expired", checkedAt: "2026-09-26" } });
    expect(attention([a], [email({})], NOW)).toEqual({ items: [], calls: [] });
  });

  it("an email for an untracked role still shows, named by its hint", () => {
    const { items } = attention([], [email({ applicationId: null, company: null, companyHint: "Globex", jobId: null })], NOW);
    expect(items[0].company).toBe("Globex");
  });
});
