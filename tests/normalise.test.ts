import { describe, it, expect } from "vitest";
import { companySlug, normaliseTitle, locationBucket, dedupeKey, isReposter, guessEmployerFromText } from "@/lib/pipeline/normalise";

describe("companySlug", () => {
  it.each([
    ["Monzo Bank Ltd", "monzo-bank"],
    ["Deloitte LLP", "deloitte"],
    ["Acme UKI", "acme"],
    ["National Energy System Operator (NESO)", "national-energy-system-operator"],
    ["Jane Street", "jane-street"],
    ["Isomorphic Labs", "isomorphic"],
    ["Capgemini", "capgemini"],
    ["Ernst & Young", "ernst-and-young"],
    // COMPANY_SLUG_ALIASES: one employer listed under two trading names by two sources
    ["EDF Energy", "edf"],
    ["EDF UK", "edf"],
  ])("%s → %s", (input, expected) => expect(companySlug(input)).toBe(expected));
});

describe("normaliseTitle", () => {
  it("drops years, punctuation, location and filler", () => {
    expect(normaliseTitle("2027 Graduate Programme – Technology (London)")).toBe("graduate programme technology");
    expect(normaliseTitle("Graduate Programme - Technology 2027 start")).toBe("graduate programme technology");
  });
  it("drops a pay tail so a LinkedIn repost matches the ATS posting (Lendable)", () => {
    expect(normaliseTitle("Graduate Analyst - £50,000 + Share Options")).toBe("graduate analyst");
    expect(normaliseTitle("Graduate Analyst (£28k-£32k)")).toBe("graduate analyst");
    expect(dedupeKey("Lendable", "Graduate Analyst - £50,000 + Share Options", "London")).toBe(dedupeKey("Lendable", "Graduate Analyst", "London"));
  });
});

describe("locationBucket", () => {
  it.each([
    ["London", "london"], ["Canary Wharf, London", "london"], ["Hybrid – London/Manchester", "london"],
    ["Manchester", "other"], ["Warwick, Warwickshire, United Kingdom", "other"],
    ["Nationwide", "uk"], ["United Kingdom", "uk"], ["Remote", "uk"], ["", "unknown"], [undefined, "unknown"],
  ])("%s → %s", (input, expected) => expect(locationBucket(input)).toBe(expected));
});

describe("dedupeKey", () => {
  it("collapses the same scheme from two sources", () => {
    const a = dedupeKey("Deutsche Bank", "Deutsche Bank Graduate Programme - Investment Banking 2027", "London, England, UK");
    const b = dedupeKey("Deutsche Bank AG", "Deutsche Bank Graduate Programme – Investment Banking", "London");
    expect(a).toBe(b);
  });
  it("keeps different locations apart", () => {
    expect(dedupeKey("RSM", "Audit Graduate", "Nottingham")).not.toBe(dedupeKey("RSM", "Audit Graduate", "London"));
  });
});

describe("reposters", () => {
  it("detects targetjobs UK on LinkedIn", () => {
    expect(isReposter("targetjobs UK")).toBe(true);
    expect(isReposter("Schroders")).toBe(false);
  });
  it("guesses the employer from the title", () => {
    expect(guessEmployerFromText("Deutsche Bank Graduate Programme - Investment Banking & Capital Markets")).toBe("Deutsche Bank");
    expect(guessEmployerFromText("2027 Internal Audit Graduate Programme")).toBeNull();
  });
});
