/**
 * TARGETjobs. Discovery via their JSON search API (city=London, opportunity_type=Graduate job), then
 * each detail page for the schema.org JobPosting (employer name, description, salary).
 *
 * Gotcha found in research: without an `Origin` header the API answers HTTP 200 with result_count 0.
 * We therefore treat zero as a failure, never as "no jobs today".
 */
import pLimit from "p-limit";
import { fetchJson, fetchText } from "../fetch";
import { parseJobPosting, jobPostingText } from "../parse/jsonld";
import { RawPosting, SourceAdapter, SourceError } from "../types";

const SEARCH_URL = "https://targetjobs.co.uk/ext/svc/inferno-search-service-1-0/search";
const BASE = "https://targetjobs.co.uk";
const LOGO_BASE = "https://images.groupgti.com/";
const PAGE = 50;
const MIN_EXPECTED = 30;

interface SearchDoc {
  nid: number; title: string; path: string; body?: string; location?: string;
  organisation?: { title?: string; logo?: { path?: string } | null; path?: string };
  opportunityType?: string[]; salary?: string | { lower?: string; upper?: string; ranges?: string[] } | null; applicationDeadline?: number | null;
  applicationUrl?: string; sectors?: string[]; scrapedJob?: boolean;
}
interface SearchResponse { search: { result_count: number; documents: SearchDoc[] } }

function searchBody(offset: number) {
  return {
    fields: ["nid", "title", "location", "parent_organisation_title", "parent_organisation_logo", "url", "application_url",
      "application_deadline_date", "opportunity_start_date", "salary_range", "salary_upper", "salary_lower", "opportunity_type",
      "body", "sectors", "external_id", "scraped_job"],
    keys: [""], groupBy: null,
    conditionGroup: { conjunction: "AND", groups: [
      { conjunction: "OR", conditions: [{ name: "city", value: "London", operator: "=" }], tags: ["facet:city"] },
      { conjunction: "OR", conditions: [{ name: "opportunity_type", value: "Graduate job", operator: "=" }], tags: ["facet:opportunity_type"] },
      { conjunction: "OR", conditions: [{ name: "application_deadline_date", value: ["0", "NOW"], operator: "NOT BETWEEN" }], tags: ["facet:application_deadline_date"] },
      { conjunction: "OR", conditions: [{ name: "type", value: "opportunity", operator: "=" }], tags: ["facet:type"] },
    ] },
    facets: [],
    sort: [{ field: "application_deadline_date", value: "asc" }],
    conditions: [{ name: "last_published", value: new Date().toISOString(), operator: "<=" }],
    limit: PAGE, offset, includePromoted: false,
  };
}

export const targetjobs: SourceAdapter = {
  source: "targetjobs",
  async run({ limit, log }) {
    const docs = await discover(log);
    const picked = limit ? docs.slice(0, limit) : docs;
    log(`fetching ${picked.length} detail pages`);
    const lim = pLimit(3);
    const results = await Promise.all(picked.map((d) => lim(() => fetchOne(d, log))));
    const postings = results.filter((p): p is RawPosting => p !== null);
    if (postings.length < Math.min(MIN_EXPECTED, picked.length) * 0.8) {
      throw new SourceError("targetjobs", "parse", `only ${postings.length}/${picked.length} detail pages parsed`);
    }
    return postings;
  },
};

async function discover(log: (m: string) => void): Promise<SearchDoc[]> {
  const all: SearchDoc[] = [];
  let expected = Infinity;
  for (let offset = 0; offset < expected; offset += PAGE) {
    let data: SearchResponse;
    try {
      ({ data } = await fetchJson<SearchResponse>(SEARCH_URL, {
        source: "targetjobs", method: "POST", noSnapshot: true,
        headers: { "content-type": "application/json", origin: BASE, referer: `${BASE}/search/jobs` },
        body: JSON.stringify(searchBody(offset)),
      }));
    } catch (e) {
      throw new SourceError("targetjobs", "discover", `search API failed at offset ${offset}`, e);
    }
    const s = data?.search;
    if (!s || typeof s.result_count !== "number") throw new SourceError("targetjobs", "discover", "unexpected search response shape");
    if (s.result_count === 0) throw new SourceError("targetjobs", "discover", "search returned result_count 0 — this is what happens when the Origin header is rejected; not treating as empty");
    expected = s.result_count;
    all.push(...s.documents);
    if (!s.documents.length) break;
  }
  const seen = new Set<number>();
  const docs = all.filter((d) => (seen.has(d.nid) ? false : (seen.add(d.nid), true)));
  if (docs.length < MIN_EXPECTED) throw new SourceError("targetjobs", "discover", `only ${docs.length} London graduate jobs (expected ≥${MIN_EXPECTED})`);
  log(`discovered ${docs.length} London graduate jobs`);
  return docs;
}

async function fetchOne(d: SearchDoc, log: (m: string) => void): Promise<RawPosting | null> {
  const url = BASE + d.path;
  let r;
  try {
    r = await fetchText(url, { source: "targetjobs" });
  } catch (e) {
    log(`skip ${url}: ${(e as Error).message}`);
    return null;
  }
  const jp = parseJobPosting(r.body);
  const companyName = jp?.companyName ?? d.organisation?.title;
  if (!companyName) { log(`skip ${url}: no employer name`); return null; }
  const deadline = d.applicationDeadline ? new Date(d.applicationDeadline * 1000).toISOString().slice(0, 10) : jp?.validThrough;
  const logoPath = d.organisation?.logo?.path;
  return {
    source: "targetjobs",
    sourceId: String(d.nid),
    url,
    title: jp?.title ?? d.title,
    companyName,
    companyUrl: jp?.companyUrl,
    logoUrl: jp?.logoUrl ?? (logoPath ? LOGO_BASE + logoPath : undefined),
    descriptionHtml: jp?.descriptionHtml ?? d.body,
    descriptionText: jp ? jobPostingText(jp) : undefined,
    locationRaw: jp?.locationRaw ?? d.location,
    ...salaryOf(d.salary, jp),
    deadline: deadline && deadline < farFuture() ? deadline : undefined,
    datePosted: jp?.datePosted,
    applyUrl: d.applicationUrl ?? url,
    kindHint: d.opportunityType?.[0],
    roleTags: d.sectors?.join(", "),
    snapshotId: r.snapshotId,
    contentHash: r.contentHash,
  };
}

/** TARGETjobs salary is a string, {lower,upper} or {ranges:[...]} depending on how the employer entered it. */
function salaryOf(s: SearchDoc["salary"], jp: ReturnType<typeof parseJobPosting>) {
  const out = { salaryMin: jp?.salaryMin, salaryMax: jp?.salaryMax, salaryCurrency: jp?.salaryCurrency, salaryText: undefined as string | undefined };
  if (!s) return out;
  if (typeof s === "string") { out.salaryText = s; return out; }
  const lo = Number(s.lower), hi = Number(s.upper);
  if (s.lower && isFinite(lo)) { out.salaryMin ??= lo; out.salaryCurrency ??= "GBP"; }
  if (s.upper && isFinite(hi)) { out.salaryMax ??= hi; }
  if (s.ranges?.length) out.salaryText = s.ranges.join("; ");
  else if (out.salaryMin) out.salaryText = out.salaryMax && out.salaryMax !== out.salaryMin ? `£${out.salaryMin.toLocaleString()}–£${out.salaryMax.toLocaleString()}` : `£${out.salaryMin.toLocaleString()}`;
  return out;
}

function farFuture(): string {
  const dt = new Date(); dt.setFullYear(dt.getFullYear() + 2); return dt.toISOString().slice(0, 10);
}
