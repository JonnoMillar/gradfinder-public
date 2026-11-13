import type { MetadataRoute } from "next";

/**
 * Hosted demo only (showcase override; the private app has no robots.txt). The Roles filters are URL state, so every
 * sort/filter combination is a distinct crawlable "page": a crawler found ~100K of them in 12 hours (2026-11-11).
 * Crawlers may read the plain pages but not the query-string variants.
 *
 * AI training crawlers are disallowed outright: ClaudeBot made 546K requests (5.28 GB) in 30 days and paused the
 * Vercel Hobby team (2026-11-12). The Vercel Firewall also denies ClaudeBot on every path except this file, so it can
 * still read the Disallow and stop. AI assistants fetching a page for a person (Claude-User, ChatGPT-User) stay allowed.
 */
const AI_TRAINING_CRAWLERS = [
  "ClaudeBot", "GPTBot", "CCBot", "Google-Extended", "Applebot-Extended", "Bytespider", "meta-externalagent",
  "Amazonbot", "Reflectionbot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: AI_TRAINING_CRAWLERS, disallow: "/" },
      { userAgent: "*", allow: "/", disallow: "/*?", crawlDelay: 10 },
    ],
  };
}
