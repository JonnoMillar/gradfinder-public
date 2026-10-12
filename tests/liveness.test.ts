/**
 * Liveness against the response shapes probed live on 2026-09-23. The rule under test: only positive evidence
 * says "closed"; a page we cannot read is "unknown"; the Attio and Scale Factory cases are the ones Jonno hit.
 */
import { describe, expect, it } from "vitest";
import { FetchError, type FetchResult } from "@/lib/pipeline/fetch";
import { checkPosting, checkUrl } from "@/lib/pipeline/liveness";

type Route = { status?: number; body?: string; finalUrl?: string };
function fakeGet(routes: Record<string, Route>) {
  const calls: string[] = [];
  const get = async (url: string): Promise<FetchResult> => {
    calls.push(url);
    const r = routes[url];
    if (!r) throw new FetchError("HTTP 404", url, 404);
    if ((r.status ?? 200) >= 400) throw new FetchError(`HTTP ${r.status}`, url, r.status);
    return { url, finalUrl: r.finalUrl ?? url, status: r.status ?? 200, body: r.body ?? "", contentHash: "", snapshotId: null };
  };
  return { get, calls };
}
const para = (s: string) => `<html><body><p>${s}</p><p>${"Lorem ipsum dolor sit amet. ".repeat(20)}</p></body></html>`;

describe("liveness", () => {
  it("Attio: the Ashby page always says 200, so the board API decides — the job is not on it", async () => {
    const { get } = fakeGet({ "https://api.ashbyhq.com/posting-api/job-board/attio": { body: JSON.stringify({ jobs: [{ id: "11111111-1111-1111-1111-111111111111", title: "GTM Graduate Associate 2027" }] }) } });
    const closed = await checkUrl("https://jobs.ashbyhq.com/attio/448ecdc1-4869-41ef-a9a2-5d0b4949ce4a", get);
    expect(closed).toMatchObject({ status: "closed", via: "ashby-api" });
    const open = await checkUrl("https://jobs.ashbyhq.com/attio/11111111-1111-1111-1111-111111111111", get);
    expect(open).toMatchObject({ status: "open", mentionsIntake: true });
  });

  it("Scale Factory: the employer page says it is no longer active", async () => {
    const url = "https://careers.scalefactory.com/jobs/8025055-graduate-ai-engineering-lab";
    const { get } = fakeGet({ [url]: { body: para("Graduate AI Engineering Lab. This position is no longer active. Either the position was filled, or the ad has expired.") } });
    const r = await checkUrl(url, get);
    expect(r.status).toBe("closed");
    expect(r.evidence).toMatch(/no longer active/);
  });

  it("Greenhouse: 404 is closed only when the board exists (AlphaSights via grnh.se)", async () => {
    const { get } = fakeGet({
      "https://grnh.se/8g1lizjz1us": { finalUrl: "https://www.alphasights.com/careers/open-roles/?gh_jid=6601908&gh_src=8g1lizjz1us" },
      "https://boards-api.greenhouse.io/v1/boards/alphasights": { body: '{"name":"AlphaSights"}' },
    });
    expect(await checkUrl("https://grnh.se/8g1lizjz1us", get)).toMatchObject({ status: "closed", via: "greenhouse-api" });
    const noBoard = fakeGet({});
    expect(await checkUrl("https://www.example-bank.com/apply?gh_jid=123", noBoard.get)).toMatchObject({ status: "unknown" });
  });

  it("Greenhouse EU: a closed job redirects to the board with ?error=true", async () => {
    const url = "https://job-boards.eu.greenhouse.io/clearscoretechnologylimited/jobs/4974869101";
    const { get } = fakeGet({ [url]: { finalUrl: "https://job-boards.eu.greenhouse.io/clearscoretechnologylimited?error=true", body: para("Jobs at ClearScore") } });
    expect(await checkUrl(url, get)).toMatchObject({ status: "closed" });
  });

  it("Workday: asks the CXS JSON the page itself calls; 404 = gone", async () => {
    const url = "https://hyperiongrp.wd3.myworkdayjobs.com/Hyperion_External/job/London---One-Creechurch-Place/Credit-Risk-Solutions-Graduate-Programme-2027_R0019260?source=Targetjobs_Job_Board";
    const api = "https://hyperiongrp.wd3.myworkdayjobs.com/wday/cxs/hyperiongrp/Hyperion_External/job/London---One-Creechurch-Place/Credit-Risk-Solutions-Graduate-Programme-2027_R0019260";
    const live = fakeGet({ [api]: { body: JSON.stringify({ jobPostingInfo: { title: "Credit Risk Solutions Graduate Programme 2027", canApply: true } }) } });
    expect(await checkUrl(url, live.get)).toMatchObject({ status: "open", via: "workday-api", mentionsIntake: true });
    expect(live.calls).toEqual([api]);
    expect(await checkUrl(url, fakeGet({}).get)).toMatchObject({ status: "closed", via: "workday-api" });
  });

  it("Workable: a bare /j/ link is followed to learn the account, then the API decides", async () => {
    const { get } = fakeGet({ "https://apply.workable.com/j/3D193F579B": { finalUrl: "https://apply.workable.com/q5-partners/j/3D193F579B" } });
    expect(await checkUrl("https://apply.workable.com/j/3D193F579B", get)).toMatchObject({ status: "closed", via: "workable-api" });
  });

  it("never calls a page it cannot read closed or open", async () => {
    const shell = "https://jobs.example.com/role/1";
    expect(await checkUrl(shell, fakeGet({ [shell]: { body: "<html><div id=app></div></html>" } }).get)).toMatchObject({ status: "unknown" });
    expect(await checkUrl(shell, fakeGet({ [shell]: { status: 403 } }).get)).toMatchObject({ status: "unknown" });
    expect(await checkUrl(shell, fakeGet({ [shell]: { status: 404 } }).get)).toMatchObject({ status: "closed" });
    // real false positive: Civil Service boilerplate on every OPEN advert (HM Treasury via LinkedIn)
    expect(await checkUrl(shell, fakeGet({ [shell]: { body: para("Financial Stability Analysts. Once this job has closed, the job advert will no longer be available.") } }).get)).toMatchObject({ status: "open" });
    // "applications close on" is a date, not a closure
    expect(await checkUrl(shell, fakeGet({ [shell]: { body: para("Graduate Analyst 2027. Applications close on 30 November 2026.") } }).get)).toMatchObject({ status: "open", mentionsIntake: true });
  });

  it("a board's own '2027' nav never confirms the intake", async () => {
    const url = "https://targetjobs.co.uk/jobs/operations-graduate-associate-235743";
    const { get } = fakeGet({ [url]: { body: para("Graduate jobs & schemes 2027. Operations Graduate Associate at Attio.") } });
    expect(await checkUrl(url, get)).toMatchObject({ status: "open", mentionsIntake: false });
  });

  it("falls back from an unreadable apply link to the board listing, and a delisted board page is closed", async () => {
    const apply = "https://jobs.example.com/role/1", board = "https://targetjobs.co.uk/jobs/graduate-ai-engineering-lab-232308";
    const { get } = fakeGet({ [apply]: { body: "<div id=app></div>" } });   // board URL absent → 404
    expect(await checkPosting({ applyUrl: apply, canonicalUrl: board }, get)).toMatchObject({ status: "closed", url: board });
  });
});
