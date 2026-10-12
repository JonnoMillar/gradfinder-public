/**
 * Higherin (formerly RateMyPlacement). Discovery via job sitemap; each job page has a schema.org
 * JobPosting + EmployerAggregateRating (student reviews) + logo. robots.txt permits.
 *
 * "Register Your Interest" pages carry no JobPosting markup (they aren't live vacancies) but are
 * useful signal, so they go through an HTML fallback parser and land as kind=register_interest.
 */
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import { fetchText } from "../fetch";
import { extractJsonLd, parseJobPosting, jobPostingText } from "../parse/jsonld";
import { htmlToText } from "../parse/html";
import { AdapterOutput, RawPosting, SourceAdapter, SourceError } from "../types";
import { recentlyFetched } from "../seen";

/** Pages fetched within this window are "touched" (kept alive) rather than re-downloaded. */
const REFETCH_AFTER_DAYS = 5;

const SITEMAP_INDEX = "https://higherin.com/sitemaps/job-sitemap-index.xml";
const GRAD_SLUG = /graduate|grad-|-grad\b|scheme|programme|program\b|analyst|early-career|entry-level|trainee/i;
const NOT_GRAD_SLUG = /internship|placement|apprentice|school-leaver|summer|insight|spring-week|work-experience|undergraduate/i;
const MIN_EXPECTED = 20;

export const higherin: SourceAdapter = {
  source: "higherin",
  async run({ limit, log }) {
    const urls = await discover(log);
    const picked = limit ? urls.slice(0, limit) : urls;
    const fresh = recentlyFetched("higherin", REFETCH_AFTER_DAYS);
    const toFetch = picked.filter((u) => !fresh.has(sourceIdOf(u)));
    const touches: AdapterOutput[] = picked.filter((u) => fresh.has(sourceIdOf(u))).map((u) => ({ source: "higherin" as const, sourceId: sourceIdOf(u), url: u, touchOnly: true as const }));
    log(`fetching ${toFetch.length} job pages, touching ${touches.length} fetched within ${REFETCH_AFTER_DAYS}d`);
    const lim = pLimit(3);
    const results = await Promise.all(toFetch.map((u) => lim(() => fetchOne(u, log))));
    const postings = results.filter((p): p is RawPosting => p !== null);
    if (toFetch.length > 0 && postings.length < Math.min(MIN_EXPECTED, toFetch.length) * 0.5) {
      throw new SourceError("higherin", "parse", `only ${postings.length}/${toFetch.length} fetched pages yielded a posting — page structure may have changed`);
    }
    return [...postings, ...touches];
  },
};

async function discover(log: (m: string) => void): Promise<string[]> {
  let idx;
  try {
    idx = await fetchText(SITEMAP_INDEX, { source: "higherin", noSnapshot: true });
  } catch (e) {
    throw new SourceError("higherin", "discover", `sitemap index unreachable`, e);
  }
  const sitemaps = [...idx.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (!sitemaps.length) throw new SourceError("higherin", "discover", "sitemap index contained no sitemaps");
  const urls = new Set<string>();
  for (const sm of sitemaps) {
    const r = await fetchText(sm, { source: "higherin", noSnapshot: true });
    for (const m of r.body.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const u = m[1];
      if (!/\/jobs\/\d+\//.test(u)) continue;
      const slug = u.split("/").pop() ?? "";
      if (GRAD_SLUG.test(slug) && !NOT_GRAD_SLUG.test(slug)) urls.add(u);
    }
  }
  if (urls.size < MIN_EXPECTED) throw new SourceError("higherin", "discover", `only ${urls.size} graduate-looking URLs in sitemap (expected ≥${MIN_EXPECTED})`);
  log(`discovered ${urls.size} graduate-looking job URLs`);
  return [...urls];
}

async function fetchOne(url: string, log: (m: string) => void): Promise<RawPosting | null> {
  let r;
  try {
    r = await fetchText(url, { source: "higherin" });
  } catch (e) {
    log(`skip ${url}: ${(e as Error).message}`);
    return null;
  }
  const sourceId = sourceIdOf(url);
  const meta = pageMeta(r.body);
  const jp = parseJobPosting(r.body);

  const common = {
    source: "higherin" as const,
    sourceId, url, applyUrl: url,
    deadlineText: meta.deadlineText,
    kindHint: meta.jobType,
    roleTags: meta.jobRoles,
    snapshotId: r.snapshotId,
    contentHash: r.contentHash,
  };

  if (jp && jp.companyName) {
    // Higherin encodes "no deadline" as validThrough far in the future.
    const deadline = jp.validThrough && jp.validThrough < farFuture() ? jp.validThrough : undefined;
    return {
      ...common,
      title: jp.title,
      companyName: jp.companyName,
      companyUrl: jp.companyUrl,
      logoUrl: jp.logoUrl,
      descriptionHtml: jp.descriptionHtml,
      descriptionText: jobPostingText(jp),
      locationRaw: jp.locationRaw ?? meta.locations,
      salaryMin: jp.salaryMin, salaryMax: jp.salaryMax, salaryCurrency: jp.salaryCurrency,
      deadline,
      deadlineText: meta.deadlineText ?? (deadline ? undefined : "Ongoing"),
      datePosted: jp.datePosted,
      employmentType: jp.employmentType,
      rating: jp.rating ? { ...jp.rating, sourceUrl: url } : undefined,
      extraFacts: jp.companyDescription ? [{ field: "what_they_do", valueText: jp.companyDescription, confidence: "medium" }] : undefined,
    };
  }

  // Fallback: no JobPosting markup (register-your-interest pages).
  if (!meta.title || !meta.companyName) return null;
  const isRyi = /register your interest/i.test(meta.title);
  return {
    ...common,
    title: meta.title,
    companyName: meta.companyName,
    companyUrl: meta.companyProfileUrl,
    logoUrl: meta.logoUrl,
    descriptionHtml: meta.descriptionHtml,
    descriptionText: meta.descriptionHtml ? htmlToText(meta.descriptionHtml) : undefined,
    locationRaw: meta.locations,
    kindHint: isRyi ? "register_interest" : meta.jobType,
    rating: meta.rating ? { ...meta.rating, sourceUrl: url } : undefined,
  };
}

interface PageMeta {
  title?: string; companyName?: string; companyProfileUrl?: string; logoUrl?: string; descriptionHtml?: string;
  locations?: string; deadlineText?: string; jobType?: string; jobRoles?: string;
  rating?: { value: number; count: number; scale: number };
}

/** Header/sidebar labels present on every Higherin job page, with or without JSON-LD. */
function pageMeta(html: string): PageMeta {
  const $ = cheerio.load(html);
  const m: PageMeta = {};
  m.title = $("h1").first().text().trim() || undefined;
  const link = $("a[href*='/company-profile/']").first();
  m.companyName = link.text().trim() || undefined;
  m.companyProfileUrl = link.attr("href");
  m.descriptionHtml = $("[class*=prose]").first().html()?.trim() || undefined;

  const text = $("body").text().replace(/\s+/g, " ");
  const grab = (label: string, stopLabels: string[]) => {
    const i = text.indexOf(label + ":");
    if (i < 0) return undefined;
    let seg = text.slice(i + label.length + 1);
    for (const s of stopLabels) { const j = seg.indexOf(s + ":"); if (j >= 0) seg = seg.slice(0, j); }
    // headings without colons that follow the label block
    seg = seg.split(/\b(Job Description|About the (role|company|programme)|Apply now|Show (more|less)|View all)\b/i)[0];
    const v = seg.trim().slice(0, 300);
    return v || undefined;
  };
  const LABELS = ["Deadline", "Job Type", "Job Roles", "Locations", "Salary", "Starting", "Positions"];
  m.deadlineText = grab("Deadline", LABELS)?.split(/\s{2,}|Job Type|Salary/)[0].trim();
  m.jobType = grab("Job Type", LABELS);
  m.jobRoles = grab("Job Roles", LABELS);
  m.locations = grab("Locations", LABELS)?.replace(/\s+(Show|View) (more|all).*$/i, "");

  const rating = extractJsonLd(html).find((b) => b["@type"] === "EmployerAggregateRating") as Record<string, unknown> | undefined;
  if (rating && typeof rating.ratingValue === "number") {
    m.rating = { value: rating.ratingValue, count: Number(rating.ratingCount ?? rating.reviewCount ?? 0), scale: Number(rating.bestRating ?? 5) };
    const org = (rating.itemReviewed ?? {}) as Record<string, unknown>;
    const logo = org.logo as Record<string, unknown> | string | undefined;
    m.logoUrl = typeof logo === "string" ? logo : (logo?.url as string | undefined);
  }
  return m;
}

function farFuture(): string {
  const d = new Date(); d.setFullYear(d.getFullYear() + 2); return d.toISOString().slice(0, 10);
}

function sourceIdOf(url: string): string {
  return url.match(/\/jobs\/(\d+)\//)?.[1] ?? url;
}
