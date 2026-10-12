/**
 * Logos for companies the sweep found no website for (config/company-domains.ts).
 *
 *   npx tsx scripts/logos.ts check   fetch each domain's homepage; verified = the company's name is in the title/site name
 *   npx tsx scripts/logos.ts apply   check, then write verified domains into companies.domain (blanks only)
 *
 * The name test uses the company's distinctive words (not "group", "uk", "the" …), so a guessed domain can't pass on
 * a shared filler word. A site behind a bot wall (403) passes only if the company's word is in the domain itself;
 * anything else that fails is reported, never written. HAND_VERIFIED domains were checked by hand.
 */
import { getSqlite } from "@/lib/db/client";
import { COMPANY_DOMAINS, HAND_VERIFIED } from "@/config/company-domains";

const FILLER = new Set(["group", "uk", "the", "and", "ltd", "limited", "plc", "co", "company", "careers", "europe", "inc", "llc", "pte", "&", "i", "eu", "graduates"]);
const words = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !FILLER.has(w));

async function check(slug: string, name: string, domain: string): Promise<{ ok: boolean; why: string }> {
  if (HAND_VERIFIED.has(domain)) return { ok: true, why: "checked by hand" };
  try {
    const r = await fetch(`https://${domain}/`, {
      redirect: "follow", signal: AbortSignal.timeout(15_000),
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36", accept: "text/html" },
    });
    const html = (await r.text()).slice(0, 200_000);
    const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").trim();
    const site = html.match(/property=["']og:site_name["'][^>]*content=["']([^"']*)/i)?.[1] ?? "";
    const hay = `${title} ${site} ${new URL(r.url).host}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const need = words(name).concat(words(slug.replace(/-/g, " ")));
    const hit = need.find((w) => hay.includes(w));
    const inHost = need.some((w) => new URL(r.url).host.replace(/[^a-z0-9]/g, "").includes(w));
    return { ok: (r.ok && !!hit) || (r.status === 403 && inHost), why: `${r.status} ${new URL(r.url).host} "${title.slice(0, 70)}"${hit ? ` ✓${hit}` : ""}` };
  } catch (e) {
    return { ok: false, why: `fetch failed: ${(e as Error).message}` };
  }
}

async function main() {
  const mode = process.argv[2] ?? "check";
  const db = getSqlite();
  const rows = db.prepare("select id, slug, name, domain, logo_url from companies where slug in (select value from json_each(?))")
    .all(JSON.stringify(Object.keys(COMPANY_DOMAINS))) as { id: number; slug: string; name: string; domain: string | null; logo_url: string | null }[];
  let ok = 0, bad = 0, wrote = 0;
  const results = await Promise.all(rows.map(async (c) => ({ c, domain: COMPANY_DOMAINS[c.slug], r: await check(c.slug, c.name, COMPANY_DOMAINS[c.slug]) })));
  for (const { c, domain, r } of results) {
    console.log(`${r.ok ? "ok  " : "FAIL"} ${c.slug.padEnd(34)} ${domain.padEnd(28)} ${r.why}`);
    if (!r.ok) { bad++; continue; }
    ok++;
    if (mode === "apply" && !c.domain) {
      db.prepare("update companies set domain = ? where id = ? and domain is null").run(domain, c.id);
      wrote++;
    }
  }
  console.log(`\n${ok} verified, ${bad} failed${mode === "apply" ? `, ${wrote} written` : ""}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
