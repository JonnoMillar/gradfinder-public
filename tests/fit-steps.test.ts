import { describe, expect, it } from "vitest";
import { fitScore, fitTier } from "@/lib/ui/fit";
import { defaultStep } from "@/lib/tracker/steps";

describe("fitTier", () => {
  it("maps scores onto medals, platinum only at the top", () => {
    expect(fitTier(85)).toBe("platinum");
    expect(fitTier(75)).toBe("platinum");
    expect(fitTier(74.9)).toBe("gold");
    expect(fitTier(60)).toBe("gold");
    expect(fitTier(59.9)).toBe("silver");
    expect(fitTier(45)).toBe("silver");
    expect(fitTier(44.9)).toBe("bronze");
    expect(fitTier(0)).toBe("bronze");
  });
  it("gives no medal to unevaluated or dealbreaker roles (negative scores)", () => {
    expect(fitTier(-2.4)).toBe("none");
    expect(fitScore(-2.4)).toBeNull();
  });
  it("shows whole points, capped at 100", () => {
    expect(fitScore(82.6)).toBe(83);
    expect(fitScore(104)).toBe(100);
  });
});

describe("defaultStep", () => {
  it("says what to do at each live stage", () => {
    expect(defaultStep("interested")?.text).toBe("Fill out the application");
    expect(defaultStep("applying")?.text).toBe("Submit the application");
    expect(defaultStep("tests")?.text).toBe("Complete the online test");
  });
  it("dates the chase three weeks after applying", () => {
    expect(defaultStep("applied", "2026-09-01T10:00:00Z")).toEqual({ text: "Chase if nothing heard", due: "2026-09-22", auto: true });
    expect(defaultStep("applied", null)?.due).toBeNull();
  });
  it("has nothing for finished roles", () => {
    for (const s of ["closed", "rejected", "dismissed", "discovered"]) expect(defaultStep(s)).toBeNull();
  });
});
