import { describe, it, expect } from "vitest";
import { boardFromUrl } from "@/lib/pipeline/discover";

describe("boardFromUrl", () => {
  it.each([
    ["https://job-boards.greenhouse.io/monzo/jobs/123", { ats: "greenhouse", slug: "monzo" }],
    ["https://boards.greenhouse.io/embed/job_board?for=Wayve", { ats: "greenhouse", slug: "wayve" }],
    ["https://jobs.lever.co/zopa/0b1c2d3e-0000-0000-0000-000000000000", { ats: "lever", slug: "zopa" }],
    ["https://jobs.ashbyhq.com/openai/1f2e/application", { ats: "ashby", slug: "openai" }],
    // locale prefix is optional; the site is the segment before /job/
    ["https://acme.wd3.myworkdayjobs.com/en-US/External_Career_Site/job/London/Graduate_JR-1", { ats: "workday", slug: "acme.wd3.myworkdayjobs.com/External_Career_Site" }],
    ["https://lbg.wd3.myworkdayjobs.com/Graduate_careers/job/London/X", { ats: "workday", slug: "lbg.wd3.myworkdayjobs.com/Graduate_careers" }],
    ["https://jobs.smartrecruiters.com/AECOM2/744000159335787-bms-consultant-", { ats: "smartrecruiters", slug: "AECOM2" }],
    ["https://apply.workable.com/grayce/j/BE5A4B9EA6/", { ats: "workable", slug: "grayce" }],
    ["https://savillsgraduates.teamtailor.com/jobs/123-x", { ats: "teamtailor", slug: "savillsgraduates.teamtailor.com" }],
    ["https://dixonwilson.pinpointhq.com/en/postings/f010", { ats: "pinpoint", slug: "dixonwilson" }],
  ])("%s", (url, want) => expect(boardFromUrl(url)).toEqual(want));

  it.each([
    "https://apply.workable.com/j/BE5A4B9EA6", // no account in the URL: liveness resolves it by redirect, discovery skips it
    "https://job-boards.eu.greenhouse.io/x/jobs/1", // EU host has another API
    "https://www.linkedin.com/jobs/view/1",
    "not a url",
  ])("%s → null", (url) => expect(boardFromUrl(url)).toBeNull());
});
