import { sha256 } from "./fetch";

/**
 * `jobs.content_hash`: a hash of what a person reads (title + description text), not of the fetched HTML. The raw page
 * changes on every fetch (Higherin: 343 of 343 re-fetched pages, Bright Network: 30 of 30), and a changed hash makes
 * `jobsToEvaluate` and extraction treat the posting as edited, i.e. re-spend Claude/LLM usage on an unchanged role.
 */
export function postingHash(title: string, descriptionText?: string | null): string {
  return sha256(`${title.trim()}\n${(descriptionText ?? "").replace(/\s+/g, " ").trim()}`);
}
