/**
 * Welcome to the Jungle (ex-Otta): UK/EU startup and scale-up roles, many never on a grad board. Discovery via the gzipped
 * job-listings sitemaps (~90k URLs, the city is in the slug); each page carries a schema.org JobPosting with
 * `experienceRequirements.monthsOfExperience`, so roles asking for more than a year are dropped here.
 * The page's `apply_url` is usually the employer's own ATS, which `npm run discover` then sweeps directly.
 * robots.txt allows /en/companies/…/jobs/ (only `/*?` and search are disallowed).
 */
import { gunzipSync } from "node:zlib";
import { fetchText } from "../fetch";
import { seniorTitle } from "../filter";
import { parseJobPosting, jobPostingText } from "../parse/jsonld";
import { AdapterOutput, RawPosting, SourceAdapter, SourceError } from "../types";
import { recentlyFetched } from "../seen";

/** Postings rarely change; a page fetched within this window is only touched (kept alive). */
const REFETCH_AFTER_DAYS = 30;
const INDEX = "https://www.welcometothejungle.com/sitemaps/index.xml.gz";
const MAX_MONTHS = 12;
const MIN_EXPECTED = 200;

/**
 * Pages sit behind an AWS WAF bot challenge (HTTP 202, empty body, `x-amzn-waf-action: challenge`) that trips after a burst
 * (2026-11-04: after ~15 pages, even at one per 4 s). We never try to get past it: fetch.ts spaces requests out, and the first challenge
 * ends the run. Pages not reached are touched if we already hold them, so each run carries on where the last stopped.
 */
export const wttj: SourceAdapter = {
  source: "wttj",
  async run({ limit, log }) {
    const urls = await discover(log);
    const picked = limit ? urls.slice(0, limit) : urls;
    const fresh = recentlyFetched("wttj", REFETCH_AFTER_DAYS);
    const known = recentlyFetched("wttj", 3650);
    const touch = (u: string): AdapterOutput => ({ source: "wttj", sourceId: sourceIdOf(u), url: u, touchOnly: true });
    // never-seen pages first, so coverage grows even when a challenge cuts the run short
    const toFetch = picked.filter((u) => !fresh.has(sourceIdOf(u))).sort((a, b) => Number(known.has(sourceIdOf(a))) - Number(known.has(sourceIdOf(b))));
    const touches = picked.filter((u) => fresh.has(sourceIdOf(u))).map(touch);
    log(`fetching ${toFetch.length} job pages, touching ${touches.length} fetched within ${REFETCH_AFTER_DAYS}d`);
    const postings: RawPosting[] = [];
    let fetched = 0, parsed = 0, experienced = 0;
    for (; fetched < toFetch.length; fetched++) {
      const r = await fetchOne(toFetch[fetched], log);
      if (r === "challenged") break;
      if (r !== null) parsed++;
      if (r === "experienced") experienced++;
      else if (r) postings.push(r);
    }
    const unreached = toFetch.slice(fetched);
    if (unreached.length) {
      log(`STOPPED: bot challenge after ${fetched} pages; ${unreached.length} left for the next run`);
      if (fetched === 0) throw new SourceError("wttj", "fetch", "bot challenge (AWS WAF) on the first page; try again later");
      touches.push(...unreached.filter((u) => known.has(sourceIdOf(u))).map(touch));
    }
    if (fetched >= 20 && parsed < fetched * 0.5) throw new SourceError("wttj", "parse", `only ${parsed}/${fetched} fetched pages yielded a JobPosting`);
    log(`${postings.length} kept, ${experienced} dropped for asking >${MAX_MONTHS} months' experience`);
    return [...postings, ...touches];
  },
};

async function discover(log: (m: string) => void): Promise<string[]> {
  const gz = async (url: string) => {
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36" }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    // served with Content-Encoding: gzip, which fetch already undoes; gunzip only if the bytes are still gzip
    return (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString("utf8");
  };
  const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  let maps: string[];
  try {
    maps = locs(await gz(INDEX)).filter((u) => u.includes("/job-listings."));
  } catch (e) {
    throw new SourceError("wttj", "discover", "sitemap index unreachable", e);
  }
  const urls = new Set<string>();
  for (const m of maps) {
    for (const u of locs(await gz(m).catch((e) => { log(`skip ${m}: ${(e as Error).message}`); return ""; }))) {
      const slug = u.match(/\/en\/companies\/[^/]+\/jobs\/([^/?#]+)$/)?.[1];
      if (!slug?.includes("_london_")) continue;
      const title = slug.split("_")[0].replace(/-/g, " ");
      if (!seniorTitle(title)) urls.add(u);
    }
  }
  if (urls.size < MIN_EXPECTED) throw new SourceError("wttj", "discover", `only ${urls.size} London non-senior URLs in ${maps.length} sitemaps`);
  log(`discovered ${urls.size} London job URLs without a senior title`);
  return [...urls];
}

async function fetchOne(url: string, log: (m: string) => void): Promise<RawPosting | "experienced" | "challenged" | null> {
  let r;
  try {
    r = await fetchText(url, { source: "wttj", retries: 2 });
  } catch (e) {
    log(`skip ${url}: ${(e as Error).message}`);
    return null;
  }
  if (r.status === 202) return "challenged"; // the WAF challenge page (a body for browsers to run, no posting)
  const jp = parseJobPosting(r.body);
  if (!jp || !jp.companyName) return null;
  const months = Number(r.body.match(/"monthsOfExperience":\s*(\d+)/)?.[1]);
  if (months > MAX_MONTHS) return "experienced";
  const employerApply = r.body.match(/apply_url\\?":\\?"(https?:[^"\\]+)/)?.[1];
  return {
    source: "wttj", sourceId: sourceIdOf(url), url, title: jp.title, companyName: jp.companyName,
    companyUrl: jp.companyUrl, logoUrl: jp.logoUrl, descriptionHtml: jp.descriptionHtml, descriptionText: jobPostingText(jp),
    locationRaw: jp.locationRaw, salaryMin: jp.salaryMin, salaryMax: jp.salaryMax, salaryCurrency: jp.salaryCurrency,
    // validThrough is not used: WTTJ stamps one on every posting, not an employer deadline (unverified, so left out)
    datePosted: jp.datePosted, applyUrl: employerApply ?? url, employmentType: jp.employmentType,
    snapshotId: r.snapshotId, contentHash: r.contentHash,
  };
}

function sourceIdOf(url: string): string {
  return url.replace(/^https:\/\/www\.welcometothejungle\.com\/en\/companies\//, "");
}
