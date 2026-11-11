import type { MetadataRoute } from "next";

/**
 * Hosted demo only (showcase override; the private app has no robots.txt). The Roles filters are URL state, so every
 * sort/filter combination is a distinct crawlable "page": a crawler found ~100K of them in 12 hours (2026-11-11).
 * Crawlers may read the plain pages but not the query-string variants.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/", disallow: "/*?", crawlDelay: 10 }] };
}
