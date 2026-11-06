/**
 * Company career pages on public ATS job-board APIs. No auth. Boards come from config/criteria.ts (hand-picked) plus
 * config/ats-boards.json (found by `npm run discover`). This is how "jobs that aren't on LinkedIn" get found: most
 * employers post to their own ATS first and many never syndicate to a board.
 *   Greenhouse:      https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
 *   Lever:           https://api.lever.co/v0/postings/{slug}?mode=json
 *   Ashby:           https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true
 *   Workday:         POST https://{host}/wday/cxs/{tenant}/{site}/jobs, then GET …/{site}{externalPath} per role
 *   SmartRecruiters: https://api.smartrecruiters.com/v1/companies/{id}/postings?country=gb, then …/postings/{id}
 *   Workable:        POST https://apply.workable.com/api/v3/accounts/{slug}/jobs, then GET api/v2/…/jobs/{shortcode}
 *   Teamtailor:      https://{host}/jobs.rss
 *   Pinpoint:        https://{slug}.pinpointhq.com/postings.json
 * Global boards: only roles that explicitly name London are kept (no "Remote"/blank); filter.ts drops obvious senior titles and
 * the extraction stage judges the rest from the description. Feeds that need a request per role (Workday, SmartRecruiters,
 * Workable) skip senior titles before that request: filter.ts would drop them anyway.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import pLimit from "p-limit";
import { ATS_SKIP_BOARDS, ATS_WATCHLIST, type AtsBoard, type AtsKind } from "@/config/criteria";
import { seniorTitle } from "../filter";
import { fetchJson, fetchText } from "../fetch";
import { htmlToText } from "../parse/html";
import { locationBucket } from "../normalise";
import { RawPosting, SourceAdapter, SourceError } from "../types";

export const DISCOVERED_FILE = path.join(process.cwd(), "config", "ats-boards.json");

/** Hand-picked boards first (they carry Jonno's sector), then discovered ones not already listed. */
export function atsBoards(): AtsBoard[] {
  const discovered: AtsBoard[] = existsSync(DISCOVERED_FILE) ? JSON.parse(readFileSync(DISCOVERED_FILE, "utf8")).boards : [];
  const key = (b: AtsBoard) => `${b.ats}|${b.slug.toLowerCase()}`;
  const seen = new Set(ATS_WATCHLIST.map(key));
  return [...ATS_WATCHLIST, ...discovered.filter((b) => !seen.has(key(b)) && !ATS_SKIP_BOARDS.has(key(b)))];
}

const isLondon = (loc?: string) => locationBucket(loc) === "london";
const senior = (title: string) => seniorTitle(title) !== null;

function makeAdapter(ats: AtsKind): SourceAdapter {
  return {
    source: ats,
    async run({ log }) {
      const entries = atsBoards().filter((w) => w.ats === ats);
      if (!entries.length) throw new SourceError(ats, "discover", "no companies configured for this ATS");
      const out: RawPosting[] = [];
      const failures: string[] = [];
      // boards are on different hosts (Workday, Teamtailor, Pinpoint) or one throttled API host, so a few at once is polite
      const lim = pLimit(4);
      await Promise.all(entries.map((w) => lim(async () => {
        try {
          const postings = await FETCHERS[ats](w.slug, w.name);
          const london = postings.filter((p) => isLondon(p.locationRaw));
          log(`${w.name}: ${postings.length} roles fetched, ${london.length} London-ish`);
          out.push(...london);
        } catch (e) {
          failures.push(`${w.name}: ${(e as Error).message}`);
          log(`FAILED ${w.name}: ${(e as Error).message}`);
        }
      })));
      // A single dead slug shouldn't kill the source, but if most fail something is wrong.
      if (failures.length > entries.length / 2) throw new SourceError(ats, "discover", `${failures.length}/${entries.length} companies failed: ${failures.join("; ")}`);
      if (!out.length) throw new SourceError(ats, "discover", "no London-ish roles from any configured company");
      return out;
    },
  };
}

const FETCHERS: Record<AtsKind, (slug: string, name: string) => Promise<RawPosting[]>> = {
  async greenhouse(slug, name) {
    interface GH { jobs: { id: number; title: string; location?: { name?: string }; absolute_url: string; content?: string; updated_at?: string; first_published?: string; departments?: { name: string }[] }[] }
    const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
    const { data, res } = await fetchJson<GH>(url, { source: "greenhouse" });
    if (!Array.isArray(data.jobs)) throw new Error("unexpected shape");
    return data.jobs.map((j) => {
      const html = j.content ? decodeEntities(j.content) : undefined;
      return {
        source: "greenhouse" as const, sourceId: `${slug}:${j.id}`, url: j.absolute_url, title: j.title, companyName: name,
        descriptionHtml: html, descriptionText: html ? htmlToText(html) : undefined,
        locationRaw: j.location?.name, applyUrl: j.absolute_url, datePosted: (j.first_published ?? j.updated_at)?.slice(0, 10),
        roleTags: j.departments?.map((d) => d.name).join(", "), snapshotId: res.snapshotId, contentHash: res.contentHash,
      };
    });
  },
  async lever(slug, name) {
    interface LV { id: string; text: string; categories?: { location?: string; team?: string; commitment?: string; allLocations?: string[] }; description?: string; descriptionPlain?: string; lists?: { text: string; content: string }[]; hostedUrl: string; applyUrl?: string; createdAt?: number; workplaceType?: string; salaryRange?: { min?: number; max?: number; currency?: string } }
    const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;
    const { data, res } = await fetchJson<LV[]>(url, { source: "lever" });
    if (!Array.isArray(data)) throw new Error("unexpected shape");
    return data.map((j) => {
      const html = [j.description ?? "", ...(j.lists ?? []).map((l) => `<h3>${l.text}</h3><ul>${l.content}</ul>`)].join("\n");
      const loc = [j.categories?.location, ...(j.categories?.allLocations ?? [])].filter(Boolean).join(" | ");
      return {
        source: "lever" as const, sourceId: `${slug}:${j.id}`, url: j.hostedUrl, title: j.text, companyName: name,
        descriptionHtml: html, descriptionText: htmlToText(html), locationRaw: loc || undefined,
        applyUrl: j.applyUrl ?? j.hostedUrl, datePosted: j.createdAt ? new Date(j.createdAt).toISOString().slice(0, 10) : undefined,
        salaryMin: j.salaryRange?.min, salaryMax: j.salaryRange?.max, salaryCurrency: j.salaryRange?.currency,
        roleTags: [j.categories?.team, j.categories?.commitment, j.workplaceType].filter(Boolean).join(", ") || undefined,
        snapshotId: res.snapshotId, contentHash: res.contentHash,
      };
    });
  },
  async ashby(slug, name) {
    interface AB { jobs: { id: string; title: string; department?: string; team?: string; location?: string; secondaryLocations?: { location?: string }[]; employmentType?: string; jobUrl: string; applyUrl?: string; descriptionHtml?: string; descriptionPlain?: string; publishedAt?: string; isRemote?: boolean; compensation?: { compensationTierSummary?: string } }[] }
    const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`;
    const { data, res } = await fetchJson<AB>(url, { source: "ashby" });
    if (!Array.isArray(data.jobs)) throw new Error("unexpected shape");
    return data.jobs.map((j) => {
      const loc = [j.location, ...(j.secondaryLocations ?? []).map((s) => s.location), j.isRemote ? "Remote" : undefined].filter(Boolean).join(" | ");
      return {
        source: "ashby" as const, sourceId: `${slug}:${j.id}`, url: j.jobUrl, title: j.title, companyName: name,
        descriptionHtml: j.descriptionHtml, descriptionText: j.descriptionPlain ?? (j.descriptionHtml ? htmlToText(j.descriptionHtml) : undefined),
        locationRaw: loc || undefined, applyUrl: j.applyUrl ?? j.jobUrl, datePosted: j.publishedAt?.slice(0, 10),
        salaryText: j.compensation?.compensationTierSummary, employmentType: j.employmentType,
        roleTags: [j.department, j.team].filter(Boolean).join(", ") || undefined,
        snapshotId: res.snapshotId, contentHash: res.contentHash,
      };
    });
  },
  async workday(slug, name) {
    // The same CXS JSON the careers page calls. The list omits descriptions (and says "3 Locations" for multi-site roles),
    // so London/multi-site, non-senior roles get one detail request each.
    interface List { total?: number; jobPostings?: { title: string; externalPath: string; locationsText?: string }[] }
    interface Detail { jobPostingInfo?: { id: string; title: string; jobDescription?: string; location?: string; additionalLocations?: string[]; startDate?: string; externalUrl?: string; timeType?: string; jobReqId?: string } }
    const [host, site] = slug.split("/");
    const base = `https://${host}/wday/cxs/${host.split(".")[0]}/${site}`;
    const page = (offset: number, searchText: string) => fetchJson<List>(`${base}/jobs`, {
      source: "workday", method: "POST", noSnapshot: true, headers: { "content-type": "application/json" },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText }),
    }).then((r) => r.data);
    // Workday reports the total on the first page only. Global tenants (Salesforce, Gartner: thousands of roles) are
    // searched for "London" instead of paged in full: that search missed 6 of 44 Canary Wharf roles at one bank
    // (2026-11-03), so it is only the fallback.
    let first = await page(0, "");
    const search = (first.total ?? 0) > 2000 ? "London" : "";
    if (search) first = await page(0, search);
    const total = Math.min(first.total ?? 0, 2000);
    const listed = [...(first.jobPostings ?? [])];
    for (let offset = 20; offset < total; offset += 20) {
      const data = await page(offset, search);
      if (!data.jobPostings?.length) break;
      listed.push(...data.jobPostings);
    }
    const wanted = listed.filter((p) => !senior(p.title) && (isLondon(p.locationsText) || /^\d+ Locations$/.test(p.locationsText ?? "")));
    const out: RawPosting[] = [];
    for (const p of wanted) {
      const { data, res } = await fetchJson<Detail>(`${base}${p.externalPath}`, { source: "workday", retries: 1 }).catch(() => ({ data: {} as Detail, res: null }));
      const j = data.jobPostingInfo;
      if (!j || !res) continue;
      const url = j.externalUrl ?? `https://${host}/${site}${p.externalPath}`;
      out.push({
        source: "workday", sourceId: `${host.split(".")[0]}:${j.jobReqId ?? j.id}`, url, title: j.title, companyName: name,
        descriptionHtml: j.jobDescription, descriptionText: j.jobDescription ? htmlToText(j.jobDescription) : undefined,
        locationRaw: [j.location, ...(j.additionalLocations ?? [])].filter(Boolean).join(" | ") || p.locationsText,
        applyUrl: url, datePosted: j.startDate?.slice(0, 10), employmentType: j.timeType,
        snapshotId: res.snapshotId, contentHash: res.contentHash,
      });
    }
    return out;
  },
  async smartrecruiters(slug, name) {
    interface Item { id: string; name: string; releasedDate?: string; location?: { fullLocation?: string; city?: string }; company?: { name?: string } }
    interface Detail { postingUrl?: string; applyUrl?: string; releasedDate?: string; typeOfEmployment?: { label?: string }; function?: { label?: string }; jobAd?: { sections?: Record<string, { title?: string; text?: string }> } }
    const api = `https://api.smartrecruiters.com/v1/companies/${slug}/postings`;
    const items: Item[] = [];
    for (let offset = 0; offset < 2000; offset += 100) {
      const { data } = await fetchJson<{ totalFound: number; content: Item[] }>(`${api}?country=gb&limit=100&offset=${offset}`, { source: "smartrecruiters", noSnapshot: true });
      items.push(...data.content);
      if (offset + 100 >= data.totalFound || !data.content.length) break;
    }
    const out: RawPosting[] = [];
    for (const it of items.filter((i) => !senior(i.name) && isLondon(i.location?.fullLocation))) {
      const { data: d, res } = await fetchJson<Detail>(`${api}/${it.id}`, { source: "smartrecruiters", retries: 1 });
      const html = Object.values(d.jobAd?.sections ?? {}).filter((s) => s.text).map((s) => `<h3>${s.title ?? ""}</h3>${s.text}`).join("\n");
      const url = d.postingUrl ?? `https://jobs.smartrecruiters.com/${slug}/${it.id}`;
      out.push({
        source: "smartrecruiters", sourceId: `${slug}:${it.id}`, url, title: it.name, companyName: it.company?.name || name,
        descriptionHtml: html, descriptionText: htmlToText(html), locationRaw: it.location?.fullLocation,
        applyUrl: url, datePosted: it.releasedDate?.slice(0, 10), employmentType: d.typeOfEmployment?.label, roleTags: d.function?.label,
        snapshotId: res.snapshotId, contentHash: res.contentHash,
      });
    }
    return out;
  },
  async workable(slug, name) {
    interface Item { shortcode: string; title: string; published?: string; remote?: boolean; locations?: { city?: string; region?: string; country?: string }[] }
    interface Detail { description?: string; requirements?: string; benefits?: string; type?: string; department?: string[]; salary_from?: number; salary_to?: number; salary_currency_iso_code?: string }
    const items: Item[] = [];
    let token: string | undefined;
    for (let page = 0; page < 50; page++) {
      const { data } = await fetchJson<{ results: Item[]; nextPage?: string }>(`https://apply.workable.com/api/v3/accounts/${slug}/jobs`, {
        source: "workable", method: "POST", noSnapshot: true, headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "", location: [], department: [], worktype: [], remote: [], ...(token ? { token } : {}) }),
      });
      items.push(...data.results);
      token = data.nextPage;
      if (!token || !data.results.length) break;
    }
    const loc = (i: Item) => (i.locations ?? []).map((l) => [l.city, l.region, l.country].filter(Boolean).join(", ")).join(" | ");
    const out: RawPosting[] = [];
    for (const it of items.filter((i) => !senior(i.title) && isLondon(loc(i)))) {
      const { data: d, res } = await fetchJson<Detail>(`https://apply.workable.com/api/v2/accounts/${slug}/jobs/${it.shortcode}`, { source: "workable", retries: 1 });
      const html = [d.description, d.requirements && `<h3>Requirements</h3>${d.requirements}`, d.benefits && `<h3>Benefits</h3>${d.benefits}`].filter(Boolean).join("\n");
      const url = `https://apply.workable.com/${slug}/j/${it.shortcode}/`;
      out.push({
        source: "workable", sourceId: `${slug}:${it.shortcode}`, url, title: it.title, companyName: name,
        descriptionHtml: html, descriptionText: htmlToText(html), locationRaw: loc(it), applyUrl: url,
        datePosted: it.published?.slice(0, 10), employmentType: d.type, roleTags: d.department?.join(", "),
        salaryMin: d.salary_from, salaryMax: d.salary_to, salaryCurrency: d.salary_currency_iso_code,
        snapshotId: res.snapshotId, contentHash: res.contentHash,
      });
    }
    return out;
  },
  async teamtailor(slug, name) {
    const r = await fetchText(`https://${slug}/jobs.rss`, { source: "teamtailor" });
    const tag = (s: string, t: string) => s.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1]?.trim();
    return [...r.body.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
      const html = decodeEntities(tag(it, "description")?.replace(/^<!\[CDATA\[|\]\]>$/g, "") ?? "");
      const link = tag(it, "link") ?? `https://${slug}/jobs`;
      const loc = [...it.matchAll(/<tt:location>([\s\S]*?)<\/tt:location>/g)].map(([, l]) => [tag(l, "tt:city"), tag(l, "tt:country")].filter(Boolean).join(", ")).join(" | ");
      const posted = tag(it, "pubDate");
      return {
        source: "teamtailor" as const, sourceId: `${slug}:${tag(it, "guid") ?? link}`, url: link, title: decodeEntities(tag(it, "title") ?? ""), companyName: name,
        descriptionHtml: html, descriptionText: htmlToText(html), locationRaw: loc || undefined, applyUrl: link,
        datePosted: posted ? new Date(posted).toISOString().slice(0, 10) : undefined,
        snapshotId: r.snapshotId, contentHash: r.contentHash,
      };
    });
  },
  async pinpoint(slug, name) {
    interface PP { data: { id: string; title: string; url: string; description?: string; key_responsibilities?: string; skills_knowledge_expertise?: string; benefits?: string; deadline_at?: string; employment_type_text?: string; workplace_type_text?: string; compensation_minimum?: number; compensation_maximum?: number; compensation_currency?: string; location?: { name?: string; city?: string } }[] }
    const { data, res } = await fetchJson<PP>(`https://${slug}.pinpointhq.com/postings.json`, { source: "pinpoint" });
    if (!Array.isArray(data.data)) throw new Error("unexpected shape");
    return data.data.map((j) => {
      const html = [j.description, j.key_responsibilities, j.skills_knowledge_expertise, j.benefits].filter(Boolean).join("\n");
      return {
        source: "pinpoint" as const, sourceId: `${slug}:${j.id}`, url: j.url, title: j.title, companyName: name,
        descriptionHtml: html, descriptionText: htmlToText(html), locationRaw: j.location?.name ?? j.location?.city, applyUrl: j.url,
        deadline: j.deadline_at?.slice(0, 10), employmentType: j.employment_type_text,
        salaryMin: j.compensation_minimum, salaryMax: j.compensation_maximum, salaryCurrency: j.compensation_currency,
        roleTags: j.workplace_type_text, snapshotId: res.snapshotId, contentHash: res.contentHash,
      };
    });
  },
};

function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

export const [greenhouse, lever, ashby, workday, smartrecruiters, workable, teamtailor, pinpoint] =
  (["greenhouse", "lever", "ashby", "workday", "smartrecruiters", "workable", "teamtailor", "pinpoint"] as const).map(makeAdapter);
export { FETCHERS as ATS_FETCHERS };
