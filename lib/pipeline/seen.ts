/** Which source ids were fetched recently — lets sitemap-driven adapters skip re-downloading unchanged pages. */
import { and, eq, gt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import type { Source } from "@/lib/db/schema";

export function recentlyFetched(source: Source, maxAgeDays: number): Map<string, string> {
  const cutoff = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();
  const rows = getDb().select({ sourceId: schema.jobSources.sourceId, url: schema.jobSources.url })
    .from(schema.jobSources)
    .where(and(eq(schema.jobSources.source, source), gt(schema.jobSources.lastFetched, cutoff))).all();
  return new Map(rows.map((r) => [r.sourceId, r.url]));
}
