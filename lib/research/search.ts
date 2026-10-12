/**
 * DuckDuckGo HTML search (html.duckduckgo.com) → result URLs + snippets. Free, no key; throttled per fetch.ts
 * HOST_MIN_GAP_MS. Snippets are search-engine text, never the page itself, so anything derived from them is
 * confidence "low" and always cites the result URL (decoded from DDG's redirect link).
 *
 * DDG answers a burst with HTTP 202 + an "anomaly" challenge page for a while (seen 2026-09-21 after ~4 requests
 * in 6 min, from curl as well as Node — it is per-IP, not a fingerprint). A page with zero results is therefore a
 * failure, never an empty answer, and a challenge puts the whole module on cooldown so a run stops hammering the
 * endpoint: callers get a fast SearchError with `challenged=true` until the cooldown lapses and carry on without
 * snippets. The orchestrator leaves such companies unstamped so a later run picks the snippets up.
 */
import * as cheerio from "cheerio";
import { fetchText } from "@/lib/pipeline/fetch";

export interface SearchResult { title: string; url: string; snippet: string }

export class SearchError extends Error {
  constructor(message: string, public readonly query: string, public readonly challenged = false) {
    super(`[duckduckgo] ${message} (${query})`); this.name = "SearchError";
  }
}

const CHALLENGE_COOLDOWN_MS = 15 * 60_000;
let challengedUntil = 0;
/** Exported for tests / a deliberate retry. */
export function resetSearchCooldown() { challengedUntil = 0; }
export function searchCoolingDownMs(now = Date.now()): number { return Math.max(0, challengedUntil - now); }

export function searchUrl(query: string): string {
  return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
}

export async function duckduckgo(query: string, opts: { fetch?: typeof fetchText; max?: number; now?: () => number } = {}): Promise<{ results: SearchResult[]; url: string }> {
  const now = opts.now ?? Date.now;
  const cooling = challengedUntil - now();
  if (cooling > 0) throw new SearchError(`on cooldown for ${Math.ceil(cooling / 1000)}s after a bot check`, query, true);
  const get = opts.fetch ?? fetchText;
  const url = searchUrl(query);
  const r = await get(url, { source: "duckduckgo", retries: 1 });
  if (r.status === 202 || isBotCheck(r.body)) {
    challengedUntil = now() + CHALLENGE_COOLDOWN_MS;
    throw new SearchError(`bot check page (HTTP ${r.status}); cooling down ${CHALLENGE_COOLDOWN_MS / 60_000} min`, query, true);
  }
  const results = parseDuckDuckGo(r.body);
  // DDG says so explicitly for rare quoted phrases; that is an answer (stored, not retried), unlike a parse failure
  if (!results.length && !isNoResults(r.body)) throw new SearchError("no results parsed", query);
  return { results: results.slice(0, opts.max ?? 8), url };
}

/** Exported for tests. */
export function parseDuckDuckGo(html: string): SearchResult[] {
  const $ = cheerio.load(html);
  const out: SearchResult[] = [];
  $("div.result").each((_, el) => {
    const e = $(el);
    if (e.hasClass("result--ad") || e.find(".badge--ad").length) return;
    const a = e.find("a.result__a").first();
    const url = decodeRedirect(a.attr("href") ?? "");
    const title = a.text().replace(/\s+/g, " ").trim();
    const snippet = e.find(".result__snippet").first().text().replace(/\s+/g, " ").trim();
    if (url && title) out.push({ title, url, snippet });
  });
  return out;
}

/** "//duckduckgo.com/l/?uddg=https%3A%2F%2Fmonzo.com%2Fcareers&rut=…" → "https://monzo.com/careers" */
export function decodeRedirect(href: string): string | null {
  try {
    const u = new URL(href.startsWith("//") ? `https:${href}` : href, "https://duckduckgo.com");
    const target = u.searchParams.get("uddg");
    if (target) return target;
    return /^https?:/.test(u.href) && !/duckduckgo\.com/.test(u.host) ? u.href : null;
  } catch { return null; }
}

export function isNoResults(html: string): boolean {
  return /no-results__message|No results found for/i.test(html);
}

function isBotCheck(html: string): boolean {
  return /anomaly\.js|challenge-form|anomaly-modal/i.test(html) && !/result__a/.test(html);
}
