/**
 * A closing date from the posting's own deadline text (2026-09-29 audit: 30+ roles showed "no deadline" while their
 * deadline text said "29th Sep 2026" or "Friday 30 October 2026": the text was kept but never turned into a date).
 *
 * Deterministic and strict: it returns a date only when the text names a day, a month and a year. "October 2027 -
 * exact date tbc", "2nd January" (which year?), "Ongoing" and "rolling basis" all return null: no date is better than
 * an invented one.
 */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");
/** "sep", "sept", "september" → 9; anything that isn't a month name → null */
const month = (w: string): number | null => {
  const full = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const m = MONTHS[w.slice(0, 4)] ?? MONTHS[w.slice(0, 3)];
  return m && (full[m - 1].startsWith(w) || w === "sept") ? m : null;
};

function valid(y: number, m: number, d: number): string | null {
  if (y < 2020 || y > 2035 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCMonth() !== m - 1) return null; // 31 September and the like
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Dates that are a source's placeholder, never an employer's deadline. Bright Network puts "28th Feb 2027" in the
 * sidebar of listings with no deadline: 118 roles at 73 companies on 2026-09-29, all with 2026-season titles and no such
 * date in their descriptions. A real 28 Feb 2027 deadline is lost with them; that's the lesser error.
 */
export const PLACEHOLDER_DATES = new Set(["2027-02-28"]);

export function parseDeadlineText(text: string | null | undefined): string | null {
  if (!text) return null;
  // "No deadline … posted on Ashby 28 Aug 2026": the only date in it is not a closing date
  if (/\bno (closing )?(deadline|date)\b|\bposted\b/i.test(text)) return null;
  const d = parseDate(text.toLowerCase());
  return d && !PLACEHOLDER_DATES.has(d) ? d : null;
}

/**
 * The last resort: a closing date stated in the description itself ("Closing date: 27th September 2026"). Only a
 * date right after a closing-date phrase counts, so start dates and assessment-centre dates are never picked up.
 */
export function deadlineFromDescription(desc: string | null | undefined): string | null {
  if (!desc) return null;
  for (const m of desc.matchAll(/(closing date|deadline|applications? (will )?close[sd]?|apply by|closes? on|closing on)[^.\n]{0,90}/gi)) {
    const d = parseDeadlineText(m[0]);
    if (d) return d;
  }
  return null;
}

function parseDate(s: string): string | null {
  // ISO: 2026-10-02
  const iso = s.match(/\b(20\d\d)-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return valid(+iso[1], +iso[2], +iso[3]);
  // 29th Sep 2026, Wednesday 30th September 2026, 25 October 2026, 23:55
  const dmy = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\.?,?\s+(20\d\d)\b/);
  const dm = dmy ? month(dmy[2]) : null;
  if (dmy && dm) return valid(+dmy[3], dm, +dmy[1]);
  // September 30, 2026 / Sep 30th 2026
  const mdy = s.match(/\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d\d)\b/);
  const mm = mdy ? month(mdy[1]) : null;
  if (mdy && mm) return valid(+mdy[3], mm, +mdy[2]);
  // 30/09/2026 (UK order)
  const dmyNum = s.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d\d)\b/);
  if (dmyNum) return valid(+dmyNum[3], +dmyNum[2], +dmyNum[1]);
  return null;
}
