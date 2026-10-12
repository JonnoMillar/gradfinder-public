import type { SourceAdapter } from "../types";
import { higherin } from "./higherin";
import { targetjobs } from "./targetjobs";
import { greenhouse, lever, ashby } from "./ats";

/** Order matters a little: cheap API sources first, throttled scrapers last. */
export const ALL_ADAPTERS: SourceAdapter[] = [greenhouse, ashby, lever, targetjobs, higherin];

export function pickAdapters(names?: string[]): SourceAdapter[] {
  if (!names?.length) return ALL_ADAPTERS;
  const unknown = names.filter((n) => !ALL_ADAPTERS.some((a) => a.source === n));
  if (unknown.length) throw new Error(`unknown source(s): ${unknown.join(", ")}. Known: ${ALL_ADAPTERS.map((a) => a.source).join(", ")}`);
  return ALL_ADAPTERS.filter((a) => names.includes(a.source));
}
