/**
 * Google News RSS search for a company, last 30 days, UK edition. Free, no key.
 * Links are Google redirect URLs (news.google.com/rss/articles/…); they resolve to the article when opened, and
 * that is the URL we store — it is the one Google actually served us.
 */
import * as cheerio from "cheerio";
import { fetchText } from "@/lib/pipeline/fetch";

export interface NewsItem {
  title: string;
  url: string;
  publishedAt: string | null;   // ISO
  sourceName: string | null;
}

export function newsSearchUrl(name: string, days = 30): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`"${name}"`)}+when:${days}d&hl=en-GB&gl=GB&ceid=GB:en`;
}

export async function googleNews(name: string, opts: { fetch?: typeof fetchText; max?: number } = {}): Promise<{ items: NewsItem[]; url: string }> {
  const get = opts.fetch ?? fetchText;
  const url = newsSearchUrl(name);
  const r = await get(url, { source: "news", noSnapshot: true, retries: 1 });
  return { items: parseNewsRss(r.body).slice(0, opts.max ?? 10), url };
}

/** Exported for tests. Titles come as "Headline - Publisher"; the publisher is also in <source>. */
export function parseNewsRss(xml: string): NewsItem[] {
  const $ = cheerio.load(xml, { xml: true });
  const items: NewsItem[] = [];
  $("item").each((_, el) => {
    const e = $(el);
    const link = e.find("link").first().text().trim();
    let title = e.find("title").first().text().trim();
    const sourceName = e.find("source").first().text().trim() || null;
    if (sourceName && title.endsWith(` - ${sourceName}`)) title = title.slice(0, -(sourceName.length + 3)).trim();
    const pub = e.find("pubDate").first().text().trim();
    const d = pub ? new Date(pub) : null;
    if (!link || !title) return;
    items.push({ title, url: link, publishedAt: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null, sourceName });
  });
  return items;
}
