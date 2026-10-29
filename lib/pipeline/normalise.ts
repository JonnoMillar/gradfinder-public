/**
 * Company resolution + cross-source dedupe.
 * dedupeKey = companySlug | normalisedTitle | locationBucket
 * Two sources listing the same scheme collapse onto one `jobs` row with two `job_sources` rows.
 */
import { COMPANY_SLUG_ALIASES, LONDON_PATTERNS, NATIONWIDE_PATTERNS, REPOSTER_NAMES } from "@/config/criteria";

const LEGAL_SUFFIXES = /\b(ltd|limited|plc|llp|llc|inc|incorporated|corp|corporation|gmbh|sa|ag|group|holdings|uk|uki|u\.k\.|europe|international|technologies|technology|labs?)\b/g;

/** "Monzo Bank Ltd" → "monzo-bank"; "Deloitte LLP" → "deloitte"; "Acme UKI" → "acme". */
export function companySlug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)/g, " ")               // drop parentheticals: "NESO (National Energy...)"
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
  const slug = base.replace(/ /g, "-")
    // If stripping suffixes emptied it (e.g. company literally called "Labs"), fall back to raw.
    || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return COMPANY_SLUG_ALIASES[slug] ?? slug;
}

const TITLE_NOISE = /\b(20\d\d|19\d\d|uk|london|start|intake|entry|opportunity|opportunities|register your interest|apply now)\b/g;

/** A pay tail some boards bolt onto a title: "- £50,000 + Share Options", "(£28k-£32k)". Same role as the ATS's plain title. */
const TITLE_PAY_TAIL = /\s*[-–—|(]?\s*[£$€]\s?\d[\d,.]*\s*k?(?:\s*(?:-|–|to)\s*[£$€]?\s?\d[\d,.]*\s*k?)?(?:\s*\+\s*[a-z ]+?)?\s*\)?\s*$/;

/** "2027 Graduate Programme – Technology (London)" → "graduate programme technology" */
export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(TITLE_PAY_TAIL, "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(TITLE_NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type LocationBucket = "london" | "uk" | "other" | "unknown";

const COUNTRY_TOKENS = /\b(united kingdom|uk|u\.k\.|england|great britain|gb)\b/gi;

export function locationBucket(locationRaw: string | undefined | null): LocationBucket {
  if (!locationRaw || !locationRaw.trim()) return "unknown";
  if (LONDON_PATTERNS.some((p) => p.test(locationRaw))) return "london";
  // "Warwick, United Kingdom" is Warwick, not nationwide: strip country words before judging.
  const withoutCountry = locationRaw.replace(COUNTRY_TOKENS, " ").replace(/[\s,|/–-]+/g, " ").trim();
  if (!withoutCountry) return "uk";
  if (NATIONWIDE_PATTERNS.some((p) => p.test(withoutCountry))) return "uk";
  return "other";
}

/** London, or "we're everywhere / flexible / remote" which we keep and let the reader judge. */
export function isLondonish(locationRaw: string | undefined | null): boolean {
  const b = locationBucket(locationRaw);
  return b === "london" || b === "uk" || b === "unknown";
}

export function dedupeKey(companyName: string, title: string, locationRaw?: string | null): string {
  return `${companySlug(companyName)}|${normaliseTitle(title)}|${locationBucket(locationRaw)}`;
}

/** True if the "company" on the posting is actually a job board reposting someone else's role. */
export function isReposter(name: string): boolean {
  const n = name.toLowerCase().trim();
  return REPOSTER_NAMES.some((r) => n === r || n.startsWith(r + " "));
}

/**
 * For reposted jobs, the real employer is usually at the start of the title ("Deutsche Bank Graduate
 * Programme - ...") or in the first line of the description. Deterministic best-effort; the LLM extraction
 * stage can correct it later.
 */
const EMPLOYER_THEN_KEYWORD =
  /^([A-Z][A-Za-z0-9&.'’-]*(?:\s+[A-Z][A-Za-z0-9&.'’-]*){0,3}?)\s+(?:[Gg]raduate|[Ee]arly [Cc]areers?|[Aa]nalyst|[Pp]rogramme|[Pp]rogram|[Ss]cheme|[Ii]nternship)\b/;

export function guessEmployerFromText(title: string, descriptionText?: string): string | null {
  const m = title.match(EMPLOYER_THEN_KEYWORD);
  if (m) return m[1].trim();
  const first = (descriptionText ?? "").split("\n").find((l) => l.trim());
  const m2 = first?.match(/\b(?:at|join|about)\s+([A-Z][A-Za-z0-9&.'’-]*(?:\s+[A-Z][A-Za-z0-9&.'’-]*){0,3})/);
  return m2 ? m2[1].trim() : null;
}
