/**
 * Deterministic rules from config/criteria.ts → excluded_reason (or null = keep).
 * Runs before any LLM call so we never spend tokens on a sales role in Manchester.
 * Excluded jobs stay in the DB with their reason; the UI hides them by default.
 *
 * This is the ONLY place a keep/drop decision is made. The sweep, extraction and the liveness check all feed
 * what they know into `excludedReason`, and `refilter()` (lib/pipeline/refilter.ts) re-runs it over every
 * active job from what is stored — so a rule added to config applies to the whole DB, not just new rows.
 */
import {
  COMBINED_INTERNSHIP_PATTERN, EXCLUDED_FUNCTIONS, EXCLUDED_JOB_KINDS, EXCLUDED_KINDS_PATTERNS, FULL_TIME_TITLE_PATTERN,
  INTAKE_YEAR, REQUIRED_LANGUAGE_EXCLUSIONS,
  SENIOR_OVERRIDE_PATTERNS, SENIOR_TITLE_PATTERNS, SOFTWARE_TITLE_PATTERN,
} from "@/config/criteria";
import { isLondonish } from "./normalise";

export type LivenessStatus = "open" | "closed" | "unknown";

export interface FilterInput {
  title: string;
  locationRaw?: string | null;
  function?: string | null;       // LLM-extracted function tag, if we have one yet
  kind?: string | null;           // job kind (source- or LLM-classified)
  kindHint?: string | null;       // raw source-provided kind text, e.g. "Internship"
  isEntryLevel?: boolean | null;  // LLM judgement from the description, if we have one yet
  /** Claude's evaluation verdict (role_evaluations.grad_role): "no" excludes; "yes"/"unsure" leave the rules to decide */
  gradRole?: { verdict: "yes" | "no" | "unsure"; reason: string } | null;
  startText?: string | null;
  description?: string | null;
  deadline?: string | null;       // YYYY-MM-DD
  liveness?: { status: LivenessStatus; evidence?: string | null } | null;
  today?: string;                 // YYYY-MM-DD, injectable for tests
}

export function excludedReason(j: FilterInput): string | null {
  const haystack = `${j.title} ${j.function ?? ""} ${j.kindHint ?? ""}`;

  // a board that copies a posting leaves "Copy of …" in the title; the original is already in the list
  if (/^\s*copy of\b/i.test(j.title)) return "duplicate:copy_of";

  const combined = COMBINED_INTERNSHIP_PATTERN.test(j.title);
  for (const p of EXCLUDED_KINDS_PATTERNS) {
    if (combined && p.test("internship")) continue;
    if (p.test(haystack)) return `not_a_grad_role:${p.source}`;
  }
  // the kind label (often the LLM's) loses to a title that names the full-time job; see FULL_TIME_TITLE_PATTERN
  if (j.kind && (EXCLUDED_JOB_KINDS as readonly string[]).includes(j.kind) && !FULL_TIME_TITLE_PATTERN.test(j.title)) return `excluded_kind:${j.kind}`;

  const softwareTitle = SOFTWARE_TITLE_PATTERN.test(j.title);
  for (const f of EXCLUDED_FUNCTIONS) {
    if (f.patterns.some((p) => p.test(haystack))) return `excluded_function:${f.key}`;
    // the LLM taxonomy (lib/pipeline/extract.ts FUNCTIONS) uses the same keys, so an exact key hit counts —
    // except where the function allows a software title through (the model files backend roles under `engineering`)
    const exempt = f.unlessSoftware !== undefined && softwareTitle;
    if (exempt) continue;
    if (j.function === f.key || f.unlessSoftware?.some((p) => p.test(haystack))) return `excluded_function:${f.key}`;
  }

  if (!isLondonish(j.locationRaw)) return "not_london";

  const lang = requiredLanguage(j.title, j.description);
  if (lang) return `language_required:${lang}`;

  if (!SENIOR_OVERRIDE_PATTERNS.some((p) => p.test(j.title))) {
    const hit = SENIOR_TITLE_PATTERNS.find((p) => p.test(j.title));
    if (hit) return `not_entry_level:title:${hit.source}`;
  }
  if (j.isEntryLevel === false) return "not_entry_level:description";
  if (j.gradRole?.verdict === "no") return `claude_not_grad:${j.gradRole.reason.slice(0, 120)}`;

  const intake = intakeStatus(j);
  if (intake.status === "contradicted") return `wrong_intake:${intake.why}`;

  const today = j.today ?? new Date().toISOString().slice(0, 10);
  if (j.deadline && /^\d{4}-\d{2}-\d{2}$/.test(j.deadline) && j.deadline < today) return "deadline_passed";

  if (j.liveness?.status === "closed") return `closed:${(j.liveness.evidence ?? "posting gone").slice(0, 120)}`;

  return null;
}

// ---------- intake year ----------

export type IntakeStatus = { status: "confirmed" | "contradicted" | "unknown"; why: string };

const YEAR = /\b(20[2-3]\d)\b/g;
/** "2026/27", "2026-2027", "2026–27" name the year the programme runs into, which is the one that counts. */
const ACADEMIC_YEAR = /\b20(\d\d)\s*[/–-]\s*(?:20)?(\d\d)\b/g;
const IMMEDIATE = /\b(asap|as soon as possible|immediate(ly)?|start(ing)? now)\b/i;
/**
 * A start date in a description: the year has to be attached to the start phrase ("starting in September 2026",
 * "our 2026 intake"). A year anywhere in a sentence that happens to say "start" is not enough — ClearScore's
 * "revenue has grown 2.5x since the start of 2024" is company history. Applications-close dates never count.
 */
const START_YEAR = /(?<!since the )\b(start(s|ing)?( date)?|commenc\w*|begin\w*|intake|cohort)\b[^.\d]{0,25}\b(20\d\d)\b|\b(20\d\d)\s+(start|intake|cohort)\b/gi;

function mentionsYear(s: string, year: number): boolean {
  for (const m of s.matchAll(ACADEMIC_YEAR)) if (2000 + Number(m[2]) === year || 2000 + Number(m[1]) === year) return true;
  for (const m of s.matchAll(YEAR)) if (Number(m[1]) === year) return true;
  return false;
}
function otherYears(s: string, year: number): number[] {
  const withoutRanges = s.replace(ACADEMIC_YEAR, " ");
  return [...withoutRanges.matchAll(YEAR)].map((m) => Number(m[1])).filter((y) => y !== year && y >= year - 3 && y <= year + 1);
}

/**
 * Is this role for the INTAKE_YEAR cohort? Only positive evidence drops a role — a posting that simply doesn't
 * say is "unknown", kept, and flagged in the UI (Jonno: "must show 2027 risks cutting ones that just don't
 * show it"). Evidence, strongest first: the title, the start text, then start phrasing in the description.
 */
export function intakeStatus(j: Pick<FilterInput, "title" | "startText" | "description">): IntakeStatus {
  const y = INTAKE_YEAR;
  const title = j.title ?? "", start = j.startText ?? "", desc = (j.description ?? "").slice(0, 6000);

  if (mentionsYear(title, y)) return { status: "confirmed", why: `title says ${y}` };
  if (mentionsYear(start, y)) return { status: "confirmed", why: `start: ${start.slice(0, 60)}` };

  const tOther = otherYears(title, y);
  if (tOther.length) return { status: "contradicted", why: `title says ${tOther[0]}` };
  const sOther = otherYears(start, y);
  if (sOther.length) return { status: "contradicted", why: `start: ${start.slice(0, 60)}` };
  if (IMMEDIATE.test(start)) return { status: "contradicted", why: `start: ${start.slice(0, 60)}` };

  const sentences = desc.split(/(?<=[.!?])\s+|\n+/);
  if (sentences.some((s) => mentionsYear(s, y))) return { status: "confirmed", why: `description mentions ${y}` };
  const startYears = (s: string) => [...s.matchAll(START_YEAR)].map((m) => Number(m[4] ?? m[5]));
  const early = sentences.find((s) => startYears(s).some((yr) => yr !== y && yr >= y - 3 && yr <= y + 1) || /\b(immediate start|start(ing)? immediately)\b/i.test(s));
  if (early) return { status: "contradicted", why: `description: ${early.trim().slice(0, 80)}` };

  return { status: "unknown", why: "no intake year stated" };
}

// ---------- required languages ----------

const LANG = `(${REQUIRED_LANGUAGE_EXCLUSIONS.join("|")})`;
const TITLE_LANG = new RegExp(`\\b${LANG}[\\s-]*(speak(er|ers|ing)|fluent|native|language)\\b|\\b(fluent|native|speaking)\\s+(in\\s+)?${LANG}\\b`, "i");
// language words only, never a bare "required": Arcadis's "support being required in Czech Republic" is a country
const NEEDS = /\b(fluen(t|cy)|native|proficien(t|cy)|business[- ]level|speak(er|ers|ing|s)?|spoken|written|language|communicat\w*)\b/i;
const SOFT = /\b(prefer|desirable|advantage|bonus|plus|nice to have|beneficial|welcome|encourag|ideally)/i;

/** A non-English language the role requires, or null. Title first; then a firm requirement in the description. */
export function requiredLanguage(title: string, description?: string | null): string | null {
  // Third Bridge posts "Associé(e), Service à la clientèle - Francophone": the -phone form, not "French speaker"
  const phone = title.match(/\b(franco|germano|hispano|luso|italo|n[ée]erlando|arabo|sino)phone\b/i);
  if (phone) return phone[0].toLowerCase();
  const t = title.match(TITLE_LANG);
  if (t) return (t[1] ?? t[6] ?? "").toLowerCase() || "unknown";
  const langWord = new RegExp(`\\b${LANG}\\b`, "i");
  for (const s of (description ?? "").slice(0, 4000).split(/(?<=[.!?])\s+|\n+/)) {
    const m = s.match(langWord);
    if (m && NEEDS.test(s) && !SOFT.test(s)) return m[1].toLowerCase();
  }
  return null;
}
