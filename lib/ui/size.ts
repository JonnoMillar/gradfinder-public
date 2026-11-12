/**
 * Company size as a band, from a `headcount` fact's text ("5,001 to 10,000 employees (Indeed)", "Approximately 880
 * employees."). A band, not a number: sources disagree and most are global, so a precise figure would claim too much.
 * Returns null for text that is not a headcount ("958 open jobs", "21 graduate places", "Aiming to double Japan headcount").
 */
export const SIZE_BANDS = ["≤10", "11–50", "51–200", "201–500", "501–1k", "1k–5k", "5k–10k", "10k+"] as const;
export type SizeBand = (typeof SIZE_BANDS)[number];

const EDGES = [11, 51, 201, 501, 1001, 5001, 10000]; // lower bound of each band after the first

export function sizeBandOf(text: string | null | undefined): SizeBand | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (!/\b(employees|staff|people|colleagues|team members|headcount|company size)\b/.test(t)
    || /graduate|open jobs|^aiming|hires|\bplaces\b/.test(t)) return null;
  // a range ("1,001 to 5,000", "1001-2000") bands by its lower bound; a single figure by itself
  const m = t.match(/(\d[\d,]*)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 1) return null;
  let i = 0;
  while (i < EDGES.length && n >= EDGES[i]) i++;
  return SIZE_BANDS[i];
}
