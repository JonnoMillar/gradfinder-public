/**
 * Company career pages on public ATS job-board APIs. No auth. Slugs live in config/criteria.ts.
 *   Greenhouse: https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
 *   Lever:      https://api.lever.co/v0/postings/{slug}?mode=json
 *   Ashby:      https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true
 * Global boards: only roles that explicitly name London are kept (no "Remote"/blank); filter.ts drops obvious senior titles and
 * the extraction stage judges the rest from the description.
 */
import { ATS_WATCHLIST } from "@/config/criteria";
import { fetchJson } from "../fetch";
import { htmlToText } from "../parse/html";
import { locationBucket } from "../normalise";
import { RawPosting, SourceAdapter, SourceError } from "../types";

type Ats = "greenhouse" | "lever" | "ashby";

function makeAdapter(ats: Ats): SourceAdapter {
  return {
    source: ats,
    async run({ log }) {
      const entries = ATS_WATCHLIST.filter((w) => w.ats === ats);
      if (!entries.length) throw new SourceError(ats, "discover", "no companies configured for this ATS");
      const out: RawPosting[] = [];
      const failures: string[] = [];
      for (const w of entries) {
        try {
          const postings = await FETCHERS[ats](w.slug, w.name);
          const london = postings.filter((p) => locationBucket(p.locationRaw) === "london");
          log(`${w.name}: ${postings.length} roles, ${london.length} London-ish`);
          out.push(...london);
        } catch (e) {
          failures.push(`${w.name}: ${(e as Error).message}`);
          log(`FAILED ${w.name}: ${(e as Error).message}`);
        }
      }
      // A single dead slug shouldn't kill the source, but if most fail something is wrong.
      if (failures.length > entries.length / 2) throw new SourceError(ats, "discover", `${failures.length}/${entries.length} companies failed: ${failures.join("; ")}`);
      if (!out.length) throw new SourceError(ats, "discover", "no London-ish roles from any configured company");
      return out;
    },
  };
}

const FETCHERS: Record<Ats, (slug: string, name: string) => Promise<RawPosting[]>> = {
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
};

function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

export const greenhouse = makeAdapter("greenhouse");
export const lever = makeAdapter("lever");
export const ashby = makeAdapter("ashby");
