/**
 * schema.org JobPosting parser. Higherin and Bright Network both embed one per job page, so this is
 * the shared deterministic parser for both. Returns null when the page has no JobPosting.
 */
import * as cheerio from "cheerio";
import { htmlToText } from "./html";

export interface JsonLdJobPosting {
  title: string;
  descriptionHtml?: string;
  companyName?: string;
  companyUrl?: string;
  logoUrl?: string;
  datePosted?: string;
  validThrough?: string;     // ISO date
  employmentType?: string;
  locationRaw?: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  rating?: { value: number; count: number; scale: number };
  companyDescription?: string;
  applyUrl?: string;
}

type Obj = Record<string, unknown>;

export function extractJsonLd(html: string): Obj[] {
  const $ = cheerio.load(html);
  const out: Obj[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text();
    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : parsed?.["@graph"] ? parsed["@graph"] : [parsed];
      for (const it of items) if (it && typeof it === "object") out.push(it as Obj);
    } catch {
      /* malformed block: ignore, other blocks may still be fine */
    }
  });
  return out;
}

export function parseJobPosting(html: string): JsonLdJobPosting | null {
  const blocks = extractJsonLd(html);
  const jp = blocks.find((b) => typeOf(b) === "JobPosting");
  if (!jp || typeof jp.title !== "string") return null;

  const org = (jp.hiringOrganization ?? {}) as Obj;
  const rating = blocks.find((b) => typeOf(b) === "EmployerAggregateRating") as Obj | undefined;
  const ratingOrg = (rating?.itemReviewed ?? {}) as Obj;

  const result: JsonLdJobPosting = { title: jp.title.trim() };
  if (typeof jp.description === "string") result.descriptionHtml = jp.description;
  result.companyName = str(org.name) ?? str(ratingOrg.name);
  result.companyUrl = str(org.sameAs) ?? str(org.url) ?? str(ratingOrg.sameAs);
  result.logoUrl = logoOf(org) ?? logoOf(ratingOrg);
  result.datePosted = str(jp.datePosted)?.slice(0, 10);
  result.validThrough = str(jp.validThrough)?.slice(0, 10);
  result.employmentType = Array.isArray(jp.employmentType) ? jp.employmentType.join(",") : str(jp.employmentType);
  result.locationRaw = locationOf(jp.jobLocation) ?? (jp.jobLocationType === "TELECOMMUTE" ? "Remote" : undefined);
  Object.assign(result, salaryOf(jp.baseSalary));
  if (rating && typeof rating.ratingValue === "number") {
    result.rating = {
      value: rating.ratingValue,
      count: Number(rating.ratingCount ?? rating.reviewCount ?? 0),
      scale: Number(rating.bestRating ?? 5),
    };
  }
  result.companyDescription = str(ratingOrg.description);
  result.applyUrl = str(jp.url) ?? str((jp.applicantLocationRequirements as Obj | undefined)?.url);
  // strip undefined keys for cleaner equality in tests
  for (const k of Object.keys(result) as (keyof JsonLdJobPosting)[]) if (result[k] === undefined) delete result[k];
  return result;
}

export function jobPostingText(jp: JsonLdJobPosting): string | undefined {
  return jp.descriptionHtml ? htmlToText(jp.descriptionHtml) : undefined;
}

// ---- helpers ----
function typeOf(b: Obj): string | undefined {
  const t = b["@type"];
  return Array.isArray(t) ? String(t[0]) : typeof t === "string" ? t : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function logoOf(org: Obj): string | undefined {
  const l = org.logo;
  if (typeof l === "string") return l;
  if (l && typeof l === "object") return str((l as Obj).url);
  return undefined;
}
function locationOf(loc: unknown): string | undefined {
  const list = Array.isArray(loc) ? loc : loc ? [loc] : [];
  const parts: string[] = [];
  for (const p of list as Obj[]) {
    const a = (p.address ?? p) as Obj;
    if (typeof a === "string") { parts.push(a); continue; }
    const bits = [a.streetAddress, a.addressLocality, a.addressRegion, a.addressCountry]
      .map(str).filter((x): x is string => !!x);
    if (bits.length) parts.push([...new Set(bits)].join(", "));
    else if (str(p.name)) parts.push(str(p.name)!);
  }
  return parts.length ? [...new Set(parts)].join(" | ") : undefined;
}
function salaryOf(bs: unknown): Partial<JsonLdJobPosting> {
  if (!bs || typeof bs !== "object") return {};
  const b = bs as Obj;
  const v = b.value as Obj | number | undefined;
  const out: Partial<JsonLdJobPosting> = {};
  out.salaryCurrency = str(b.currency);
  if (typeof v === "number") { out.salaryMin = out.salaryMax = v; }
  else if (v && typeof v === "object") {
    const min = num(v.minValue) ?? num(v.value);
    const max = num(v.maxValue) ?? num(v.value);
    if (min !== undefined) out.salaryMin = min;
    if (max !== undefined) out.salaryMax = max;
  }
  return out;
}
function num(v: unknown): number | undefined {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && isFinite(Number(v))) return Number(v);
  return undefined;
}
