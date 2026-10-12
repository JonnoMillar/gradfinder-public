import type { Source } from "@/lib/db/schema";

/**
 * What a source adapter hands to the orchestrator: one normalised posting, as parsed deterministically
 * from the source. Nothing here has been through an LLM. Optional fields are "the source didn't say".
 */
export interface RawPosting {
  source: Source;
  sourceId: string;          // stable id within the source (sitemap id, API id, job_url hash)
  url: string;               // where we saw it
  title: string;
  companyName: string;
  companyUrl?: string;       // employer's own site if the source gives it
  logoUrl?: string;
  descriptionHtml?: string;
  descriptionText?: string;
  locationRaw?: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  salaryText?: string;
  deadline?: string;         // ISO date YYYY-MM-DD
  deadlineText?: string;
  startText?: string;
  datePosted?: string;
  applyUrl?: string;
  employmentType?: string;
  /** Source-provided kind hint, e.g. TARGETjobs "Graduate scheme". Extraction may override. */
  kindHint?: string;
  /** Source-provided role/function tags, e.g. Higherin "Job Roles: Tax Accounting Audit". Stored as a fact, not used for exclusion. */
  roleTags?: string;
  /** Employer rating from the source (Higherin student reviews, Indeed employee reviews). */
  rating?: { value: number; count: number; scale: number; sourceUrl: string };
  /** Anything else worth keeping as a fact with provenance (e.g. Indeed headcount). */
  extraFacts?: { field: string; valueText: string; valueJson?: unknown; confidence: "high" | "medium" | "low" }[];
  snapshotId?: number | null;
  contentHash?: string;
}

/** Thrown by adapters. The orchestrator records it against the run and keeps going with other sources. */
export class SourceError extends Error {
  constructor(public readonly source: Source, public readonly stage: string, message: string, cause?: unknown) {
    super(`[${source}/${stage}] ${message}`, { cause });
    this.name = "SourceError";
  }
}

export interface SourceAdapter {
  source: Source;
  /** Returns every relevant posting the source currently lists. Must throw SourceError on failure. */
  run(opts: { limit?: number; log: (msg: string) => void }): Promise<AdapterOutput[]>;
}

/**
 * Lightweight "still listed, not re-fetched" record. Adapters emit these for URLs seen recently so a
 * sweep doesn't re-download every page; ingest just bumps last_seen so stale detection keeps the job.
 */
export interface TouchPosting {
  source: Source;
  sourceId: string;
  url: string;
  touchOnly: true;
}
export type AdapterOutput = RawPosting | TouchPosting;
export function isTouch(p: AdapterOutput): p is TouchPosting {
  return (p as TouchPosting).touchOnly === true;
}
