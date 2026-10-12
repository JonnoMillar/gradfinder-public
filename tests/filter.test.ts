import { describe, it, expect } from "vitest";
import { excludedReason } from "@/lib/pipeline/filter";

describe("excludedReason", () => {
  it("keeps a London generalist scheme", () => {
    expect(excludedReason({ title: "Graduate Programme 2027 - Technology", locationRaw: "London" })).toBeNull();
  });
  it("keeps hybrid London and nationwide", () => {
    expect(excludedReason({ title: "Graduate Analyst", locationRaw: "Hybrid - London/Bristol" })).toBeNull();
    expect(excludedReason({ title: "Graduate Analyst", locationRaw: "Nationwide" })).toBeNull();
  });
  it("excludes non-London", () => {
    expect(excludedReason({ title: "Graduate Analyst", locationRaw: "Manchester" })).toBe("not_london");
  });
  it("excludes ruled-out functions by title", () => {
    expect(excludedReason({ title: "Graduate Sales Executive", locationRaw: "London" })).toBe("excluded_function:sales");
    expect(excludedReason({ title: "Tax Graduate - London - September 2027", locationRaw: "London" })).toBe("excluded_function:tax");
    expect(excludedReason({ title: "Audit Graduate", locationRaw: "London" })).toBe("excluded_function:audit");
    expect(excludedReason({ title: "Graduate Marketing Assistant", locationRaw: "London" })).toBe("excluded_function:marketing");
    expect(excludedReason({ title: "Graduate Project Manager", locationRaw: "London" })).toBe("excluded_function:project_management");
  });
  it("excludes ruled-out functions by extracted function tag", () => {
    expect(excludedReason({ title: "Graduate Programme", locationRaw: "London", function: "Human resources" })).toBe("excluded_function:hr");
  });
  it("excludes non-grad postings", () => {
    expect(excludedReason({ title: "Degree Apprenticeship - Software", locationRaw: "London" })).toMatch(/^not_a_grad_role/);
    expect(excludedReason({ title: "Army Undergraduate Bursary", locationRaw: "London" })).toMatch(/^not_a_grad_role/);
  });
  it("does not over-match: 'Salesforce Developer' is not sales, 'Legal & General' is not legal", () => {
    expect(excludedReason({ title: "Graduate Salesforce Developer", locationRaw: "London" })).toBeNull();
  });
});

describe("seniority", () => {
  it("excludes clearly senior titles from ATS boards", () => {
    expect(excludedReason({ title: "Senior Software Engineer", locationRaw: "London" })).toMatch(/^not_entry_level:title/);
    expect(excludedReason({ title: "Head of Growth", locationRaw: "London" })).toMatch(/^not_entry_level:title/);
    expect(excludedReason({ title: "Engineering Manager, Platform", locationRaw: "London" })).toMatch(/^not_entry_level:title/);
    expect(excludedReason({ title: "Research Scientist II", locationRaw: "London" })).toMatch(/^not_entry_level:title/);
  });
  it("keeps grad/junior/analyst titles even when they contain a senior word", () => {
    expect(excludedReason({ title: "Graduate Management Trainee", locationRaw: "London" })).toBeNull();
    expect(excludedReason({ title: "Junior Data Analyst", locationRaw: "London" })).toBeNull();
    expect(excludedReason({ title: "Associate, Strategy & Operations", locationRaw: "London" })).toBeNull();
  });
  it("leaves ambiguous titles to the LLM, then honours its judgement", () => {
    expect(excludedReason({ title: "Software Engineer", locationRaw: "London" })).toBeNull();
    expect(excludedReason({ title: "Software Engineer", locationRaw: "London", isEntryLevel: false })).toBe("not_entry_level:description");
    expect(excludedReason({ title: "Software Engineer", locationRaw: "London", isEntryLevel: true })).toBeNull();
  });
});

describe("excludedReason with taxonomy function keys (from LLM extraction)", () => {
  it("excludes on an exact EXCLUDED_FUNCTIONS key even when no regex matches the key text", () => {
    expect(excludedReason({ title: "Graduate Programme", locationRaw: "London", function: "hr" })).toBe("excluded_function:hr");
    expect(excludedReason({ title: "Graduate Programme", locationRaw: "London", function: "project_management" })).toBe("excluded_function:project_management");
  });
  it("keeps allowed taxonomy keys", () => {
    for (const f of ["software_engineering", "data", "rotational", "commercial", "unknown"]) {
      expect(excludedReason({ title: "Graduate Programme", locationRaw: "London", function: f })).toBeNull();
    }
  });
});
