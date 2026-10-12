/**
 * Wikipedia REST summary for a company. Free, no key, robots-friendly.
 *
 * Two failure modes, two guards:
 *  - the article is not about an organisation at all ("Faculty" → the academic sense, "Jane Street" → the
 *    Manhattan street): rejected by the `ORG_WORDS` wording test below.
 *  - the article is about a DIFFERENT organisation with a similar-looking name, or about a person connected
 *    to the employer ("Attio" → GV (company), "Freshminds" → Caroline Plumb): rejected by `titleMatchesName`,
 *    which compares the article title to the employer name. This runs first and costs nothing.
 *
 * Both fail closed: no summary is better than the wrong company's summary. A pair that legitimately shares no
 * token and no initialism is left to the second tier — the LLM's `wikipedia_matches_employer` check in
 * `orchestrator.ts`, which sees the employer's own posting blurb and its London job titles.
 */
import { FetchError, fetchJson } from "@/lib/pipeline/fetch";

export interface WikiSummary {
  title: string;
  description: string | null;   // Wikipedia's short description, e.g. "British neobank"
  extract: string;              // plain-text lead section
  url: string;                  // canonical desktop page URL
}

interface RestSummary {
  type: string;
  title: string;
  description?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
}

const ORG_WORDS = /\b(company|companies|firm|bank|neobank|start-?up|organi[sz]ation|corporation|business|developer|manufacturer|provider|group|plc|ltd|inc\b|conglomerate|retailer|publisher|broadcaster|agency|consultancy|consulting|fund|exchange|insurer|operator|laboratory|lab\b|subsidiary|brand|platform|studio|enterprise|network|authority|department|ministry|service)/i;

/** Dropped before comparing: they carry no identity, so two names sharing only these are not the same employer. */
const GENERIC = new Set([
  "ltd", "limited", "llp", "llc", "plc", "inc", "incorporated", "corp", "corporation", "co",
  "company", "companies", "group", "holdings", "holding", "international", "global", "worldwide",
  "uk", "gb", "usa", "us", "britain", "british", "england", "europe", "european",
  "services", "service", "solutions", "technologies", "technology", "partners", "associates",
  "consulting", "consultancy", "capital", "ventures", "partnership", "equity",
]);
/** Dropped from the initialism too — "Canadian Imperial Bank of Commerce" is CIBC, not CIBOC. */
const SMALL = new Set(["the", "and", "of", "a", "an", "for", "in", "at", "on", "to", "de"]);

/**
 * Tokens of a name: a trailing parenthetical qualifier dropped ("GV (company)" → ["GV"]), accents folded
 * ("L'Oréal" → ["LOreal"]) and an ampersand inside a word absorbed ("S&P Global" → ["SP", "Global"]) while a
 * free-standing one stays a separator ("Ernst & Young" → ["Ernst", "Young"]). Case is preserved for initialisms.
 */
function tokens(s: string): string[] {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s*\([^)]*\)\s*$/, " ")
    .replace(/[.'\u2019]/g, "")
    .replace(/(?<=\S)&(?=\S)/g, "")
    .split(/[^A-Za-z0-9]+/).filter(Boolean);
}
const significant = (ws: string[]) => ws.filter((w) => !SMALL.has(w.toLowerCase()));
/** Identity-bearing tokens. Falls back to the significant ones if stripping generics would leave nothing. */
function core(ws: string[]): string[] {
  const sig = significant(ws);
  const kept = sig.filter((w) => !GENERIC.has(w.toLowerCase()));
  return (kept.length ? kept : sig).map((w) => w.toLowerCase());
}
/** An initialism: an all-caps token ("AIG", "CRA"), or a lone short word however it is cased ("Lseg"). */
function initialisms(ws: string[]): string[] {
  const out = ws.filter((w) => /^[A-Za-z]{2,6}$/.test(w) && w === w.toUpperCase());
  if (ws.length === 1 && /^[A-Za-z]{2,6}$/.test(ws[0])) out.push(ws[0].toUpperCase());
  return out;
}
const initials = (ws: string[]) => significant(ws).map((w) => w[0].toUpperCase()).join("");
/** "Citi" / "Citigroup", "Franklintempleton" / "Franklin Templeton" — run-together and clipped house names. */
const prefixes = (a: string, b: string) => (a.length >= 4 && b.startsWith(a)) || (b.length >= 4 && a.startsWith(b));

/**
 * Exported for tests: is this article about THE employer, or just about something with a similar name?
 *
 * Accepts on a shared identity-bearing token ("EDF UK" / "EDF Energy"), one token being the other's prefix
 * ("Citi" / "Citigroup"), or an initialism that spells the other side out exactly, in either direction
 * ("AIG" / "American International Group", "Charles River Associates" / "CRA International"). Exact means
 * every significant word counts: "ICE" does not spell "U.S. Immigration and Customs Enforcement" (UICE),
 * which is the whole point.
 */
export function titleMatchesName(title: string, name: string): boolean {
  const tw = tokens(title);
  const nw = tokens(name);
  if (!tw.length || !nw.length) return false;
  const tc = core(tw);
  // the HEAD of the name has to be the thing that matches. Sharing a trailing category word is not identity:
  // "Budweiser Brewing Group" / "Genesee Brewing Company" share "brewing", "Private Equity Insights" /
  // "Insight Partners" share "insight" — in both, the distinctive first word disagrees.
  const head = core(nw)[0];
  if (head && head.length >= 2 && tc.some((t) => t === head || prefixes(head, t))) return true;
  return initialisms(nw).some((a) => a === initials(tw)) || initialisms(tw).some((a) => a === initials(nw));
}

interface SearchResponse { query?: { search?: { title: string }[] } }

export function searchApiUrl(name: string): string {
  return `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name)}&format=json&srlimit=3&srprop=`;
}

/**
 * Try the exact title first (cheapest, usually right), then the top-3 search hits in order ("Jane Street" →
 * "Jane Street Capital", "Lovable" → "Lovable (company)"). First standard, organisation-looking summary whose
 * title still names this employer wins.
 */
export async function wikipediaSummary(name: string, opts: { fetch?: typeof fetchJson } = {}): Promise<WikiSummary | null> {
  const get = opts.fetch ?? fetchJson;
  const tried = new Set<string>();
  const candidates: string[] = [name];
  for (let i = 0; i < candidates.length; i++) {
    const title = candidates[i];
    if (tried.has(title.toLowerCase())) continue;
    tried.add(title.toLowerCase());
    let data: RestSummary | null = null;
    try {
      ({ data } = await get<RestSummary>(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`, { source: "wikipedia", noSnapshot: true, retries: 3 }));
    } catch (e) {
      if (!(e instanceof FetchError && e.status === 404)) throw e;
    }
    const s = data && pickSummary(data, name);
    if (s) return s;
    if (i === 0) {
      // exact title missed: ask the search index once and queue its suggestions
      const { data: sr } = await get<SearchResponse>(searchApiUrl(name), { source: "wikipedia", noSnapshot: true, retries: 3 });
      for (const hit of sr.query?.search ?? []) candidates.push(hit.title);
    }
  }
  return null;
}

/**
 * Exported for tests: accept only standard articles that name this employer and describe an organisation.
 * `name` is the employer we are researching — a redirect or a search hit can land anywhere, so the title is
 * checked against it even when we asked for the exact title.
 */
export function pickSummary(data: RestSummary, name: string): WikiSummary | null {
  if (data.type !== "standard" || !data.extract) return null;
  if (!titleMatchesName(data.title, name)) return null;
  const description = data.description ?? null;
  const looksLikeOrg = ORG_WORDS.test(description ?? "") || ORG_WORDS.test(data.extract.split(/(?<=\.)\s/)[0] ?? "");
  if (!looksLikeOrg) return null;
  return { title: data.title, description, extract: data.extract.trim(), url: data.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(data.title.replace(/ /g, "_"))}` };
}
