/**
 * Research fetchers against saved real responses (tests/fixtures, captured 2026-09-21):
 *  - Wikipedia REST summary: standard company article accepted; disambiguation / non-organisation rejected
 *  - Google News RSS: items with title, Google link, ISO date, publisher stripped from the title
 *  - DuckDuckGo HTML: result URL decoded from the redirect link, snippet text flattened, ads skipped, empty = error
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pickSummary, wikipediaSummary } from "@/lib/research/wikipedia";
import { newsSearchUrl, parseNewsRss } from "@/lib/research/news";
import { decodeRedirect, duckduckgo, parseDuckDuckGo, resetSearchCooldown, searchCoolingDownMs, searchUrl } from "@/lib/research/search";
import { FetchError } from "@/lib/pipeline/fetch";

const fx = (n: string) => fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8");

describe("wikipedia", () => {
  it("accepts a standard organisation article and returns the canonical page URL", () => {
    const s = pickSummary(JSON.parse(fx("wikipedia-monzo.json")), "Monzo")!;
    expect(s.title).toBe("Monzo");
    expect(s.description).toBe("British neobank");
    expect(s.url).toBe("https://en.wikipedia.org/wiki/Monzo");
    expect(s.extract).toMatch(/^Monzo Bank Limited/);
  });
  it("rejects disambiguation pages and articles that are not about an organisation", () => {
    expect(pickSummary({ type: "disambiguation", title: "Faculty", extract: "Faculty may refer to:" }, "Faculty")).toBeNull();
    expect(pickSummary({ type: "standard", title: "Faculty (academic staff)", description: "academic staff of a university", extract: "Faculty is the academic staff of a university." }, "Faculty")).toBeNull();
  });
  it("falls back to the search index's hits when the exact title misses, and gives up cleanly", async () => {
    const calls: string[] = [];
    const pages: Record<string, unknown> = {
      Faculty: { type: "disambiguation", title: "Faculty" },
      "Jane_Street": { type: "standard", title: "Jane Street", description: "street in Manhattan, New York", extract: "Jane Street is a street in the West Village." },
      "Jane_Street_Capital": { type: "standard", title: "Jane Street Capital", description: "American proprietary trading firm", extract: "Jane Street Capital is a global proprietary trading firm.", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Jane_Street_Capital" } } },
    };
    const fetch = (async (url: string) => {
      calls.push(url);
      if (url.includes("list=search")) {
        const q = decodeURIComponent(url.split("srsearch=")[1].split("&")[0]);
        return { data: { query: { search: q === "Jane Street" ? [{ title: "Jane Street Capital" }, { title: "Jane Street" }] : [{ title: "The Faculty" }] } }, res: {} as never };
      }
      const key = decodeURIComponent(url.split("/summary/")[1]);
      if (key in pages) return { data: pages[key], res: {} as never };
      throw new FetchError("HTTP 404", url, 404);
    }) as never;
    expect((await wikipediaSummary("Jane Street", { fetch }))?.url).toBe("https://en.wikipedia.org/wiki/Jane_Street_Capital");
    calls.length = 0;
    expect(await wikipediaSummary("Faculty", { fetch })).toBeNull();
    expect(calls).toEqual([
      "https://en.wikipedia.org/api/rest_v1/page/summary/Faculty",
      "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=Faculty&format=json&srlimit=3&srprop=",
      "https://en.wikipedia.org/api/rest_v1/page/summary/The_Faculty",
    ]);
  });
});

describe("google news rss", () => {
  it("builds a quoted, 30-day, UK-edition query", () => {
    expect(newsSearchUrl("Jane Street")).toBe('https://news.google.com/rss/search?q=%22Jane%20Street%22+when:30d&hl=en-GB&gl=GB&ceid=GB:en');
  });
  it("parses items with the publisher stripped from the title", () => {
    const items = parseNewsRss(fx("gnews-monzo.xml"));
    expect(items.length).toBeGreaterThan(20);
    expect(items[0]).toEqual({ title: "Monzo Tunes in to Its Target Audience", url: expect.stringMatching(/^https:\/\/news\.google\.com\/rss\/articles\//), publishedAt: "2026-09-03T13:55:19.000Z", sourceName: "System1 Group" });
    for (const i of items) { expect(i.url).toMatch(/^https?:\/\//); expect(i.title).not.toBe(""); }
  });
});

describe("duckduckgo", () => {
  it("decodes the redirect link to the real result URL", () => {
    expect(decodeRedirect("//duckduckgo.com/l/?uddg=https%3A%2F%2Fmonzo.com%2Fcareers&rut=91bf")).toBe("https://monzo.com/careers");
    expect(decodeRedirect("https://example.com/x")).toBe("https://example.com/x");
    expect(decodeRedirect("")).toBeNull();
  });
  it("parses results with flattened snippets", () => {
    const r = parseDuckDuckGo(fx("ddg-monzo-salary.html"));
    expect(r).toHaveLength(10);
    expect(r[0]).toEqual({ title: "Careers at Monzo", url: "https://monzo.com/careers", snippet: expect.stringContaining("piloting early careers programmes across Monzo") });
    expect(r[1].url).toBe("https://www.glassdoor.co.uk/Salary/Monzo-Bank-Salaries-E1557148.htm");
    expect(r[1].snippet).not.toContain("<b>");
  });
  it("treats a challenge page (HTTP 202) as a failure and puts the module on cooldown, so the next call fails fast", async () => {
    resetSearchCooldown();
    let calls = 0;
    let t = 1_000_000;
    const fetch = (async () => { calls++; return { body: "<html><body><form class=\"challenge-form\" action=\"//duckduckgo.com/anomaly.js\"></form></body></html>", status: 202 }; }) as never;
    await expect(duckduckgo("x", { fetch, now: () => t })).rejects.toMatchObject({ challenged: true, message: expect.stringMatching(/bot check page \(HTTP 202\)/) });
    await expect(duckduckgo("y", { fetch, now: () => t })).rejects.toMatchObject({ challenged: true, message: expect.stringMatching(/on cooldown/) });
    expect(calls).toBe(1);
    expect(searchCoolingDownMs(t)).toBe(15 * 60_000);
    t += 15 * 60_000 + 1;
    await expect(duckduckgo("z", { fetch, now: () => t })).rejects.toMatchObject({ challenged: true });
    expect(calls).toBe(2);
    resetSearchCooldown();
    expect(searchUrl('"Monzo" graduate salary')).toBe("https://html.duckduckgo.com/html/?q=%22Monzo%22%20graduate%20salary");
  });
  it("DDG's own 'No results found' page is an empty answer, not an error", async () => {
    resetSearchCooldown();
    const fetch = (async () => ({ body: "<html><body><div class='no-results'><p class='no-results__message'>No results found for \"EDF UK\" culture glassdoor</p></div></body></html>", status: 200 })) as never;
    expect((await duckduckgo("x", { fetch })).results).toEqual([]);
  });
  it("an empty non-challenge page is 'no results parsed', not a cooldown", async () => {
    resetSearchCooldown();
    const fetch = (async () => ({ body: "<html><body>nothing</body></html>", status: 200 })) as never;
    await expect(duckduckgo("x", { fetch })).rejects.toMatchObject({ challenged: false, message: expect.stringMatching(/no results parsed/) });
    expect(searchCoolingDownMs()).toBe(0);
  });
});
