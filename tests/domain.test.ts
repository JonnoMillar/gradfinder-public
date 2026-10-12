import { describe, expect, it } from "vitest";
import { domainOf } from "@/lib/pipeline/run";

describe("domainOf", () => {
  it("keeps an employer's own site", () => {
    expect(domainOf("https://www.unilever.co.uk/careers")).toBe("unilever.co.uk");
  });
  it("never takes a job board or link shortener as the company's domain", () => {
    for (const url of ["https://uk.indeed.com/cmp/x", "https://uk.linkedin.com/company/x", "https://higherin.com/x",
      "https://bit.ly/abc", "https://pwc.to/x", "https://targetjobs.co.uk/x"]) expect(domainOf(url)).toBeUndefined();
  });
});
