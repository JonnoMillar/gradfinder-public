/**
 * Finds employer ATS boards to sweep, so coverage grows past the hand-picked watchlist. Two free inputs:
 *  1. every URL already in the DB (apply links from TARGETjobs/Bright Network/LinkedIn often point at the employer's
 *     own ATS, and that board usually lists more roles than the job boards ever carried);
 *  2. the Common Crawl URL index (`--crawl`): every Greenhouse/Lever/Ashby board the public web links to.
 * Each candidate is probed with the real sweep fetcher and kept only if it lists a London role. Output:
 * config/ats-boards.json, which lib/pipeline/sources/ats.ts sweeps next to the hand-picked list.
 */
import type { AtsBoard, AtsKind } from "@/config/criteria";
import { fetchJson, fetchText } from "./fetch";

/** The board a URL belongs to, or null. Only the feeds ats.ts can read. */
export function boardFromUrl(raw: string): { ats: AtsKind; slug: string } | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const h = u.host.toLowerCase();
  const seg = u.pathname.split("/").filter(Boolean);
  const first = seg[0]?.toLowerCase();
  const ok = (s?: string) => !!s && /^[A-Za-z0-9][\w.-]*$/.test(s);
  // EU-hosted Greenhouse/Lever boards use other API hosts; not supported yet
  if (h === "boards.greenhouse.io" || h === "job-boards.greenhouse.io") {
    const slug = first === "embed" ? u.searchParams.get("for") ?? undefined : first;
    return ok(slug) ? { ats: "greenhouse", slug: slug!.toLowerCase() } : null;
  }
  if (h === "boards-api.greenhouse.io") return ok(seg[2]) ? { ats: "greenhouse", slug: seg[2].toLowerCase() } : null;
  if (h === "jobs.lever.co") return ok(first) ? { ats: "lever", slug: first! } : null;
  if (h === "jobs.ashbyhq.com") return ok(first) ? { ats: "ashby", slug: first! } : null;
  if (/^[\w-]+\.wd\d+\.myworkdayjobs\.com$/.test(h)) {
    const site = /^[a-z]{2}-[A-Z]{2}$/.test(seg[0] ?? "") ? seg[1] : seg[0];
    return ok(site) && site !== "wday" ? { ats: "workday", slug: `${h}/${site}` } : null;
  }
  if (h === "jobs.smartrecruiters.com" || h === "careers.smartrecruiters.com") return ok(seg[0]) ? { ats: "smartrecruiters", slug: seg[0] } : null;
  if (h === "apply.workable.com") return ok(first) && !["j", "api"].includes(first!) ? { ats: "workable", slug: first! } : null;
  if (h.endsWith(".teamtailor.com") && !h.startsWith("app.")) return { ats: "teamtailor", slug: h };
  if (h.endsWith(".pinpointhq.com")) return { ats: "pinpoint", slug: h.split(".")[0] };
  return null;
}

/** Board slugs the Common Crawl index has seen for one ATS host. Free; slow (the index answers in tens of seconds). */
export async function commonCrawlSlugs(host: "job-boards.greenhouse.io" | "boards.greenhouse.io" | "jobs.lever.co" | "jobs.ashbyhq.com", log: (m: string) => void): Promise<string[]> {
  const { data: colls } = await fetchJson<{ "cdx-api": string }[]>("https://index.commoncrawl.org/collinfo.json", { source: "discover", noSnapshot: true, timeoutMs: 60_000 });
  const api = colls[0]["cdx-api"];
  const q = `${api}?url=${host}/*&output=json&fl=url&filter=status:200`;
  const pages = Number((await fetchText(`${q}&showNumPages=true`, { source: "discover", noSnapshot: true, timeoutMs: 120_000 })).body.match(/"pages":\s*(\d+)/)?.[1] ?? 1);
  const slugs = new Set<string>();
  for (let p = 0; p < pages; p++) {
    const r = await fetchText(`${q}&page=${p}`, { source: "discover", noSnapshot: true, timeoutMs: 180_000, retries: 2 }).catch((e) => { log(`  page ${p}: ${(e as Error).message}`); return null; });
    for (const m of r?.body.matchAll(/"url":\s*"([^"]+)"/g) ?? []) {
      const b = boardFromUrl(m[1]);
      if (b) slugs.add(b.slug);
    }
    log(`  ${host} page ${p + 1}/${pages}: ${slugs.size} boards so far`);
  }
  return [...slugs];
}

/** Display name for a board found without a company attached (Common Crawl). Null when the board doesn't say. */
export async function boardName(b: { ats: AtsKind; slug: string }): Promise<string | null> {
  if (b.ats === "greenhouse") {
    const { data } = await fetchJson<{ name?: string }>(`https://boards-api.greenhouse.io/v1/boards/${b.slug}`, { source: "discover", noSnapshot: true, retries: 1 });
    return data.name?.trim() || null;
  }
  const page = b.ats === "lever" ? `https://jobs.lever.co/${b.slug}` : b.ats === "ashby" ? `https://jobs.ashbyhq.com/${b.slug}` : null;
  if (!page) return null;
  const r = await fetchText(page, { source: "discover", noSnapshot: true, retries: 1 });
  const t = r.body.match(/<title>([^<]+)<\/title>/i)?.[1]?.replace(/&amp;/g, "&").replace(/\s*(jobs|careers)( page)?\s*$/i, "").replace(/^(jobs|careers) at\s+/i, "").trim();
  return t && t.length < 60 && !/^(jobs|ashby|lever)$/i.test(t) ? t : null;
}

export type DiscoveredBoard = AtsBoard & { londonRoles: number; from: "db" | "crawl"; checked: string };
