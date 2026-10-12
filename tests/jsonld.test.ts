import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseJobPosting, jobPostingText } from "@/lib/pipeline/parse/jsonld";

const fx = (n: string) => fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8");

describe("parseJobPosting", () => {
  it("parses a Higherin job page incl. salary, location, rating and logo", () => {
    const jp = parseJobPosting(fx("higherin-job-neso.html"))!;
    expect(jp).not.toBeNull();
    expect(jp.title).toBe("Graduate Power System Engineer 2027");
    expect(jp.companyName).toBe("National Energy System Operator (NESO)");
    expect(jp.salaryMin).toBe(35000);
    expect(jp.salaryCurrency).toBe("GBP");
    expect(jp.locationRaw).toMatch(/Warwick/);
    expect(jp.rating).toEqual({ value: 4.6, count: 41, scale: 5 });
    expect(jp.logoUrl).toMatch(/^https:\/\/imagekit-production\.higherin\.com\//);
    const text = jobPostingText(jp)!;
    expect(text).toContain("minimum 2:2 degree");
    expect(text).not.toContain("<p>");
  });

  it("returns null when there is no JobPosting", () => {
    expect(parseJobPosting("<html><head><script type='application/ld+json'>{\"@type\":\"WebSite\"}</script></head></html>")).toBeNull();
    expect(parseJobPosting("<html></html>")).toBeNull();
  });
});
