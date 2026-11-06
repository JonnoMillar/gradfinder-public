/**
 * npm run discover [-- --crawl] [--ats workday,greenhouse] [--recheck]
 * Finds employer ATS boards (lib/pipeline/discover.ts), probes each with the sweep fetcher, and writes the ones with a
 * London role to config/ats-boards.json. Boards already in the file are kept without a re-probe unless --recheck.
 * Then `npm run sweep -- --source workday,smartrecruiters,...` picks them up.
 */
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import pLimit from "p-limit";
import { getSqlite } from "../lib/db/client";
import { ATS_KINDS, ATS_SKIP_BOARDS, ATS_WATCHLIST, type AtsKind } from "../config/criteria";
import { ATS_FETCHERS, DISCOVERED_FILE } from "../lib/pipeline/sources/ats";
import { boardFromUrl, boardName, commonCrawlSlugs, type DiscoveredBoard } from "../lib/pipeline/discover";
import { locationBucket } from "../lib/pipeline/normalise";

async function main() {
  const args = process.argv.slice(2);
  const crawl = args.includes("--crawl");
  const recheck = args.includes("--recheck");
  const only = args.includes("--ats") ? (args[args.indexOf("--ats") + 1].split(",") as AtsKind[]) : [...ATS_KINDS];
  const key = (b: { ats: string; slug: string }) => `${b.ats}|${b.slug.toLowerCase()}`;

  const prior: DiscoveredBoard[] = existsSync(DISCOVERED_FILE) ? JSON.parse(readFileSync(DISCOVERED_FILE, "utf8")).boards : [];
  const known = new Set([...ATS_WATCHLIST.map(key), ...(recheck ? [] : prior.map(key))]);

  // 1. boards behind URLs we already hold, named after the company those jobs belong to
  const rows = getSqlite().prepare(`
    select u.url, c.name from (
      select j.company_id cid, j.apply_url url from jobs j union all select j.company_id, j.canonical_url from jobs j
      union all select j.company_id, s.url from job_sources s join jobs j on j.id = s.job_id
    ) u join companies c on c.id = u.cid where u.url is not null`).all() as { url: string; name: string }[];
  const cands = new Map<string, { ats: AtsKind; slug: string; name: string | null; from: "db" | "crawl" }>();
  const names = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const b = boardFromUrl(r.url);
    if (!b || !only.includes(b.ats) || known.has(key(b)) || ATS_SKIP_BOARDS.has(key(b))) continue;
    cands.set(key(b), { ...b, name: null, from: "db" });
    const n = names.get(key(b)) ?? new Map<string, number>();
    names.set(key(b), n.set(r.name, (n.get(r.name) ?? 0) + 1));
  }
  // a board's jobs can carry a source's odd spelling ("Lseg"); the name most of its jobs use is the company we hold
  for (const [k, n] of names) cands.get(k)!.name = [...n].sort((a, b) => b[1] - a[1])[0][0];
  console.log(`${cands.size} new boards behind URLs in the DB`);

  // 2. Common Crawl: startups and scale-ups that never reached a grad board
  if (crawl) {
    const hosts = [["greenhouse", "job-boards.greenhouse.io"], ["greenhouse", "boards.greenhouse.io"], ["lever", "jobs.lever.co"], ["ashby", "jobs.ashbyhq.com"]] as const;
    for (const [ats, host] of hosts.filter(([a]) => only.includes(a))) {
      // the index answers 504 when busy; a host that fails is skipped and can be re-run later
      const slugs = await commonCrawlSlugs(host, console.log).catch((e) => { console.log(`  ${host}: Common Crawl failed (${(e as Error).message.slice(0, 60)})`); return []; });
      for (const slug of slugs) {
        const b = { ats, slug };
        if (!known.has(key(b)) && !ATS_SKIP_BOARDS.has(key(b)) && !cands.has(key(b))) cands.set(key(b), { ...b, name: null, from: "crawl" });
      }
    }
    console.log(`${cands.size} candidate boards after Common Crawl`);
  }

  // 3. probe: the real fetcher, kept if any role is in London
  const found: DiscoveredBoard[] = [];
  const failed: string[] = [];
  let done = 0;
  const lim = pLimit(4);
  await Promise.all([...cands.values()].map((c) => lim(async () => {
    const t0 = Date.now();
    try {
      const name = c.name ?? await boardName(c);
      if (!name) return;
      // one slow board (a big Workday tenant being rate-limited) must not hold up the rest
      const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("gave up after 4 min")), 240_000).unref());
      const london = (await Promise.race([ATS_FETCHERS[c.ats](c.slug, name), timeout])).filter((p) => locationBucket(p.locationRaw) === "london").length;
      if (Date.now() - t0 > 30_000) console.log(`  slow: ${c.ats}:${c.slug} ${Math.round((Date.now() - t0) / 1000)}s`);
      if (london > 0) found.push({ ats: c.ats, slug: c.slug, name, londonRoles: london, from: c.from, checked: new Date().toISOString().slice(0, 10) });
    } catch (e) {
      failed.push(`${c.ats}:${c.slug} ${(e as Error).message.slice(0, 60)}`);
    } finally {
      if (++done % 25 === 0) console.log(`  probed ${done}/${cands.size}, ${found.length} with London roles`);
    }
  })));

  const keep = (recheck ? found : [...prior.filter((p) => !found.some((f) => key(f) === key(p))), ...found]).filter((b) => !ATS_SKIP_BOARDS.has(key(b)));
  keep.sort((a, b) => a.ats.localeCompare(b.ats) || a.name.localeCompare(b.name));
  writeFileSync(DISCOVERED_FILE, JSON.stringify({ note: "Generated by `npm run discover`. Edit config/criteria.ts ATS_WATCHLIST to pin a board by hand.", generated: new Date().toISOString(), boards: keep }, null, 2) + "\n");
  console.log(`\n${found.length} new boards with London roles (${keep.length} in the file). ${failed.length} probes failed.`);
  const byAts = Object.entries(Object.groupBy(keep, (b) => b.ats)).map(([a, l]) => `${a} ${l!.length}`).join(", ");
  console.log(`by ATS: ${byAts}`);
  if (failed.length) console.log(`failed (first 15):\n  ${failed.slice(0, 15).join("\n  ")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
