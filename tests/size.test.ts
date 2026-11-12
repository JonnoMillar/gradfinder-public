import { describe, expect, it } from "vitest";
import { sizeBandOf } from "@/lib/ui/size";

describe("sizeBandOf", () => {
  it("bands Indeed ranges by their lower bound", () => {
    expect(sizeBandOf("10,000+ employees (Indeed)")).toBe("10k+");
    expect(sizeBandOf("5,001 to 10,000 employees (Indeed)")).toBe("5k–10k");
    expect(sizeBandOf("1,001 to 5,000 employees (Indeed)")).toBe("1k–5k");
    expect(sizeBandOf("501 to 1,000 employees (Indeed)")).toBe("501–1k");
    expect(sizeBandOf("201 to 500 employees (Indeed)")).toBe("201–500");
    expect(sizeBandOf("51 to 200 employees (Indeed)")).toBe("51–200");
    expect(sizeBandOf("11 to 50 employees (Indeed)")).toBe("11–50");
    expect(sizeBandOf("2 to 10 employees (Indeed)")).toBe("≤10");
    expect(sizeBandOf("1001-2000 employees")).toBe("1k–5k");
  });
  it("bands free-text figures", () => {
    expect(sizeBandOf("Approximately 23,500 staff.")).toBe("10k+");
    expect(sizeBandOf("Just over 700 people.")).toBe("501–1k");
    expect(sizeBandOf("299 employees worldwide as of March 2026.")).toBe("201–500");
    expect(sizeBandOf("50,000+ employees globally")).toBe("10k+");
    expect(sizeBandOf("more than 2,800 colleagues worldwide in more than 45 countries")).toBe("1k–5k");
    expect(sizeBandOf("13,000 company size")).toBe("10k+");
    expect(sizeBandOf("about 4,500 staff (March 2026), aiming for 8,000 by end-2026")).toBe("1k–5k");
  });
  it("refuses text that is not a headcount", () => {
    for (const s of ["958 open jobs", "21 graduate places", "130+ permanent graduates each year",
      "hires about 2,500 recent graduates each year", "Aiming to double Japan headcount to 100",
      "Decline to state employees (Indeed)", "", null]) expect(sizeBandOf(s)).toBeNull();
  });
});
