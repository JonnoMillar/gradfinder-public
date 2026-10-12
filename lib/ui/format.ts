/**
 * Presentation helpers shared by every page.
 *
 * Rule for this module: it formats values, it never invents them. A missing value returns null
 * and the caller renders a "Not stated" slot — absence must stay visible (see docs/design/DECISION.md).
 */
import { SECTOR_WEIGHTS } from "@/config/criteria";

export type Urgency = "today" | "week" | "month" | "later" | "past" | "none";

/**
 * Calendar days from today (the machine's local date — London) to the deadline day: 0 = today, 1 = tomorrow,
 * negative = past. Null when no deadline was published. (It used to count hours to 23:59 UTC and round up, so a
 * deadline today read "1d left" and tomorrow "2d left" — overstating the time left.)
 */
export function daysUntil(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}

export function urgencyOf(iso: string | null | undefined, now = new Date()): Urgency {
  const d = daysUntil(iso, now);
  if (d === null) return "none";
  if (d < 0) return "past";
  if (d === 0) return "today";
  if (d <= 7) return "week";
  if (d <= 30) return "month";
  return "later";
}

/** Colour tier for the days-left figure. Colour is never the only signal — the number is there too. */
export function deadlineTier(iso: string | null | undefined, now = new Date()): string {
  const d = daysUntil(iso, now);
  if (d === null) return "open";
  if (d < 0) return "past";
  if (d <= 3) return "hot";
  if (d <= 7) return "warm";
  if (d <= 30) return "mid";
  return "cool";
}

export function deadlineLabel(iso: string | null | undefined, now = new Date()): string {
  const d = daysUntil(iso, now);
  if (d === null) return "No deadline published";
  if (d < 0) return `Closed ${Math.abs(d)}d ago`;
  if (d === 0) return "Closes today";
  return `${d}d left`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London",
  });
}

export const KIND_LABEL: Record<string, string> = {
  graduate_scheme: "Scheme", graduate_job: "Grad role", register_interest: "Register interest",
  internship: "Internship", placement: "Placement", insight: "Insight",
  other: "Other", unknown: "Unclassified",
};
export const kindLabel = (k: string) => KIND_LABEL[k] ?? k.replace(/_/g, " ");

export const SECTOR_LABEL: Record<string, string> = {
  ai: "AI", fintech: "Fintech", quant: "Quant", deep_tech: "Deep tech", climate: "Climate",
  health: "Health", defence: "Defence", big_tech: "Big tech", consumer_tech: "Consumer tech",
  media: "Media", government: "Government", energy: "Energy", consulting: "Consulting", other: "Other",
};
export const sectorLabel = (s: string | null | undefined) =>
  s ? (SECTOR_LABEL[s] ?? s.replace(/_/g, " ")) : "Not researched";

/**
 * Hue per sector, for the row dot. `other` and unresearched deliberately have no hue: giving them
 * a colour would imply a classification we did not make. The word is always available too.
 */
export const SECTOR_HUE: Record<string, number> = {
  ai: 300, fintech: 195, quant: 210, deep_tech: 255, climate: 155, health: 350,
  defence: 110, big_tech: 270, consumer_tech: 330, media: 20, government: 250,
  energy: 130, consulting: 15,
};
export const sectorColor = (s: string | null | undefined): string =>
  s && SECTOR_HUE[s] !== undefined ? `oklch(0.76 0.10 ${SECTOR_HUE[s]})` : "oklch(0.52 0.015 322)";
export const sectorHasHue = (s: string | null | undefined): boolean =>
  Boolean(s && SECTOR_HUE[s] !== undefined);

/** All sectors the config knows about, for the filter row. */
export const ALL_SECTORS = Object.keys(SECTOR_WEIGHTS);

/** "£30,000 to £35,000" → "£30–35k". The full string always stays on the factfile. */
export function shortPay(text: string | null | undefined): string | null {
  if (!text) return null;
  const nums = [...text.matchAll(/£\s?([\d,]+)/g)]
    .map((m) => Number(m[1].replace(/,/g, "")))
    .filter((n) => n >= 1000);
  if (!nums.length) return null;
  const k = (n: number) => `${Math.round(n / 1000)}k`;
  const [lo, hi] = [Math.min(...nums), Math.max(...nums)];
  return lo === hi ? `£${k(lo)}` : `£${Math.round(lo / 1000)}–${k(hi)}`;
}

/**
 * Multi-office listings count as London if London is one of the offices (a Stage 2 decision),
 * so show London as primary and name the others rather than hiding them.
 */
export function locationParts(raw: string | null | undefined): { primary: string; others: string[] } {
  if (!raw) return { primary: "Not stated", others: [] };
  const parts = raw.split("|").map((p) => p.trim()).filter(Boolean);
  const london = parts.find((p) => /london/i.test(p));
  const others = parts.filter((p) => p !== london).map((p) => p.split(",")[0].trim());
  return { primary: london ? "London" : (parts[0] ?? raw), others };
}

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url.slice(0, 40); }
}

export const initials = (name: string): string =>
  name.split(/[\s&]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

/** Logo, else the pipeline's favicon fallback, else null → the initials mark. */
export function logoSrc(c: { logoUrl?: string | null; domain?: string | null }): string | null {
  if (c.logoUrl) return c.logoUrl;
  if (c.domain) return `https://www.google.com/s2/favicons?sz=128&domain=${c.domain}`;
  return null;
}

export const REQ_FIELDS = [
  ["cv", "CV"], ["cover_letter", "Cover letter"], ["motivational_questions", "Motivational questions"],
  ["video_interview", "Video interview"], ["online_tests", "Online tests"],
  ["assessment_centre", "Assessment centre"],
] as const;

export type ReqState = "yes" | "no" | "unknown";
export const reqState = (v: unknown): ReqState => (v === true ? "yes" : v === false ? "no" : "unknown");
export const reqWord = (s: ReqState) => (s === "yes" ? "Required" : s === "no" ? "Not needed" : "Not stated");

/** rank.ts applies these in this order; the factfile shows them as a ledger that sums to rank_score. */
export const RANK_LABELS: Record<string, string> = {
  // v2: Claude's evaluation (lib/evaluate), max 100
  work_fit: "Work fit (of 30)",
  chance: "Realistic chance (of 20)",
  company_type: "Company type (of 15)",
  career_path: "Career path (of 15)",
  sector: "Sector (of 10)",
  pay: "Pay (of 10)",
  sport_tech: "Sport and tech together",
  dealbreaker: "Dealbreaker",
  register_interest: "Register interest only",
  requires_first: "Requires a first",
  // v1: roles Claude hasn't evaluated yet
  not_evaluated: "Not evaluated yet",
  sector_weight: "Sector match",
  ai_forward: "AI-forward (×2)",
  deadline_urgency: "Deadline proximity",
  eligibility_risk: "Eligibility risk",
  kind_bonus: "Role kind",
  intake_unconfirmed: "2027 intake not confirmed",
};
export function rankLines(b: Record<string, number> | null | undefined) {
  if (!b) return [];
  return Object.keys(RANK_LABELS)
    .filter((k) => k in b)
    .map((k) => ({ key: k, label: RANK_LABELS[k], value: Number(b[k] ?? 0) }));
}

export const APPLICATION_STATUS_LABEL: Record<string, string> = {
  discovered: "Discovered", interested: "Interested", applying: "Applying", applied: "Applied",
  tests: "Tests", tests_done: "Tests sat", hirevue: "HireVue", hirevue_done: "HireVue done", interview: "Interview", interview_done: "Interviewed", offer: "Offer", rejected: "Rejected", dismissed: "Dismissed",
  closed: "Closed",
};

/** Deadline filter windows offered on the list. */
export const DEADLINE_WINDOWS = [
  { key: "week", label: "Closes ≤7d" },
  { key: "month", label: "Closes ≤30d" },
  { key: "none", label: "No deadline" },
] as const;
export type DeadlineWindow = (typeof DEADLINE_WINDOWS)[number]["key"];
