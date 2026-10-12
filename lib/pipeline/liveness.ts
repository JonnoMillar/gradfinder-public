/**
 * Is this posting still open? Job boards keep listing roles the employer has already closed (Attio's
 * "Operations Graduate Associate" was on TARGETjobs while Ashby said "job not found"), so the only
 * trustworthy answer is the employer's own system.
 *
 * One handler per ATS, each asking that ATS's public JSON API, because most modern job pages are rendered
 * in the browser — an HTTP 200 from jobs.ashbyhq.com or *.myworkdayjobs.com says nothing. Everything else gets
 * a page check: 404/410, a redirect to the board with ?error=true, or closing wording on the page.
 *
 * Only positive evidence says "closed". A page we cannot read (JS shell, 403, bot check) is "unknown", never
 * "open" and never "closed" — dropping a live role Jonno would apply to is worse than showing a dead one.
 */
import { FetchError, fetchText, type FetchResult } from "./fetch";
import { htmlToText } from "./parse/html";
import type { LivenessStatus } from "./filter";
import { INTAKE_YEAR } from "@/config/criteria";

export interface LivenessCheck {
  status: LivenessStatus;
  evidence: string;
  url: string;          // what was actually checked
  via: string;          // ashby-api | greenhouse-api | lever-api | workday-api | workable-api | page
  mentionsIntake?: boolean;
}

type Get = (url: string, opts: { source: string; noSnapshot?: boolean; retries?: number; headers?: Record<string, string> }) => Promise<FetchResult>;

// Civil Service adverts say "Once this job has closed, the job advert will no longer be available" on every open
// posting (HM Treasury, HM Land Registry via LinkedIn) — a conditional is not a closure, hence the lookbehind.
const CLOSED = /(?<!\b(once|when|if|after|until|before|by the time)\b[^.]{0,20})(no longer (active|accepting applications|available|open|advertised|live)|job (not found|has expired|is no longer|has been (filled|removed|closed))|position (has been filled|is (now )?closed|is no longer)|(this|the) (vacancy|role|job|position|posting|advert) (has|is) (now )?(closed|expired)|applications (are|have) (now )?closed|this job has expired|job you('re| are) looking for (is|was|can'?t|no longer))/i;
const intakeRe = () => new RegExp(`\\b${INTAKE_YEAR}\\b|\\b${INTAKE_YEAR - 1}\\s*[/–-]\\s*(20)?${String(INTAKE_YEAR).slice(2)}\\b`);

const status = (e: unknown) => (e instanceof FetchError ? e.status : undefined);
const snippet = (text: string, m: RegExpMatchArray) => text.slice(Math.max(0, (m.index ?? 0) - 30), (m.index ?? 0) + m[0].length + 30).replace(/\s+/g, " ").trim();

/** Check the employer's apply link first; fall back to the board's own page when that says nothing. */
export async function checkPosting(job: { applyUrl?: string | null; canonicalUrl?: string | null }, get: Get = fetchText): Promise<LivenessCheck> {
  const urls = [...new Set([job.applyUrl, job.canonicalUrl].filter((u): u is string => !!u && /^https?:\/\//.test(u)))];
  if (!urls.length) return { status: "unknown", evidence: "no posting URL", url: "", via: "none" };
  let first: LivenessCheck | null = null;
  for (const u of urls) {
    const r = await checkUrl(u, get);
    if (r.status !== "unknown") return first?.mentionsIntake ? { ...r, mentionsIntake: true } : r;
    first ??= r;
  }
  return first!;
}

export async function checkUrl(url: string, get: Get = fetchText): Promise<LivenessCheck> {
  try {
    const h = new URL(url).host;
    if (h === "jobs.ashbyhq.com") return await ashby(url, get);
    if (/(^|\.)greenhouse\.io$/.test(h) && /\/jobs\/\d+/.test(url)) return await greenhouseBoardPage(url, get);
    if (h === "jobs.lever.co") return await lever(url, get);
    if (h.endsWith(".myworkdayjobs.com")) return await workday(url, get);
    if (h === "apply.workable.com") return await workable(url, get);
    if (h === "grnh.se" || /[?&]gh_jid=\d+/.test(url)) return await greenhouseCustomDomain(url, get);
    return await page(url, get);
  } catch (e) {
    return { status: "unknown", evidence: `check failed: ${(e as Error).message.slice(0, 80)}`, url, via: "error" };
  }
}

// ---------- ATS APIs ----------

const ashbyBoards = new Map<string, Promise<{ ids: Set<string>; text: Map<string, string> } | null>>();
async function ashby(url: string, get: Get): Promise<LivenessCheck> {
  const m = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{36})/i);
  if (!m) return page(url, get);
  const [, org, id] = m;
  if (!ashbyBoards.has(org)) {
    ashbyBoards.set(org, get(`https://api.ashbyhq.com/posting-api/job-board/${org}`, { source: "liveness", noSnapshot: true })
      .then((r) => {
        const jobs = (JSON.parse(r.body).jobs ?? []) as { id: string; title?: string; descriptionPlain?: string }[];
        return { ids: new Set(jobs.map((j) => j.id)), text: new Map(jobs.map((j) => [j.id, `${j.title ?? ""} ${j.descriptionPlain ?? ""}`])) };
      })
      .catch(() => null));
  }
  const board = await ashbyBoards.get(org)!;
  if (!board) return { status: "unknown", evidence: `could not read ${org}'s Ashby board`, url, via: "ashby-api" };
  if (!board.ids.has(id)) return { status: "closed", evidence: `no longer listed on ${org}'s Ashby job board`, url, via: "ashby-api" };
  return { status: "open", evidence: `listed on ${org}'s Ashby job board`, url, via: "ashby-api", mentionsIntake: intakeRe().test(board.text.get(id) ?? "") };
}

/** job-boards(.eu).greenhouse.io/<board>/jobs/<id>: a closed job redirects to the board with ?error=true. */
async function greenhouseBoardPage(url: string, get: Get): Promise<LivenessCheck> {
  const m = url.match(/greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/);
  if (m && !url.includes(".eu.")) return greenhouseApi(m[1], m[2], url, get);
  const r = await get(url, { source: "liveness", noSnapshot: true, retries: 1 }).catch((e) => e as FetchError);
  if (r instanceof Error) return status(r) === 404 ? { status: "closed", evidence: "HTTP 404", url, via: "page" } : { status: "unknown", evidence: r.message, url, via: "page" };
  if (/[?&]error=true/.test(r.finalUrl ?? "")) return { status: "closed", evidence: "Greenhouse redirected to the job board (job not found)", url, via: "page" };
  const text = htmlToText(r.body);
  return { status: "open", evidence: "Greenhouse job page live", url, via: "page", mentionsIntake: intakeRe().test(text) };
}

async function greenhouseApi(board: string, id: string, url: string, get: Get): Promise<LivenessCheck> {
  try {
    const r = await get(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}`, { source: "liveness", noSnapshot: true, retries: 1 });
    const j = JSON.parse(r.body) as { title?: string; content?: string };
    return { status: "open", evidence: `listed on ${board}'s Greenhouse board`, url, via: "greenhouse-api", mentionsIntake: intakeRe().test(`${j.title ?? ""} ${j.content ?? ""}`) };
  } catch (e) {
    if (status(e) !== 404) throw e;
    // 404 is only "closed" if the board itself exists; otherwise we guessed the board name wrong
    const boardOk = await get(`https://boards-api.greenhouse.io/v1/boards/${board}`, { source: "liveness", noSnapshot: true, retries: 1 }).then(() => true, () => false);
    return boardOk
      ? { status: "closed", evidence: `not on ${board}'s Greenhouse board (job not found)`, url, via: "greenhouse-api" }
      : { status: "unknown", evidence: `no Greenhouse board named ${board}`, url, via: "greenhouse-api" };
  }
}

/** grnh.se short links and company sites carrying ?gh_jid=: the board is usually named after the domain. */
async function greenhouseCustomDomain(url: string, get: Get): Promise<LivenessCheck> {
  let final = url;
  if (new URL(url).host === "grnh.se") {
    const r = await get(url, { source: "liveness", noSnapshot: true, retries: 1 });
    final = r.finalUrl ?? url;
  }
  const id = final.match(/[?&]gh_jid=(\d+)/)?.[1];
  if (!id) return page(final, get);
  const labels = new URL(final).host.replace(/^www\./, "").split(".");
  return greenhouseApi(labels[0], id, url, get);
}

async function lever(url: string, get: Get): Promise<LivenessCheck> {
  const m = url.match(/jobs\.lever\.co\/([^/?#]+)\/([0-9a-f-]{36})/i);
  if (!m) return page(url, get);
  try {
    const r = await get(`https://api.lever.co/v0/postings/${m[1]}/${m[2]}`, { source: "liveness", noSnapshot: true, retries: 1 });
    return { status: "open", evidence: `listed on ${m[1]}'s Lever board`, url, via: "lever-api", mentionsIntake: intakeRe().test(r.body) };
  } catch (e) {
    if (status(e) === 404) return { status: "closed", evidence: `not on ${m[1]}'s Lever board`, url, via: "lever-api" };
    throw e;
  }
}

/** <tenant>.wdN.myworkdayjobs.com/[locale/]<site>/job/<location>/<slug>_<req> → the CXS JSON the page itself calls. */
async function workday(url: string, get: Get): Promise<LivenessCheck> {
  const u = new URL(url);
  const tenant = u.host.split(".")[0];
  const parts = u.pathname.split("/").filter(Boolean);
  if (/^[a-z]{2}-[A-Z]{2}$/.test(parts[0] ?? "")) parts.shift();
  const jobAt = parts.indexOf("job");
  if (jobAt < 1) return { status: "unknown", evidence: "Workday URL without a /job/ path", url, via: "workday-api" };
  const api = `https://${u.host}/wday/cxs/${tenant}/${parts[jobAt - 1]}/job/${parts.slice(jobAt + 1).join("/")}`;
  try {
    const r = await get(api, { source: "liveness", noSnapshot: true, retries: 1, headers: { accept: "application/json" } });
    const info = (JSON.parse(r.body).jobPostingInfo ?? {}) as { title?: string; jobDescription?: string; canApply?: boolean };
    if (info.canApply === false) return { status: "closed", evidence: "Workday: applications not accepted", url, via: "workday-api" };
    return { status: "open", evidence: "live on the employer's Workday site", url, via: "workday-api", mentionsIntake: intakeRe().test(`${info.title ?? ""} ${info.jobDescription ?? ""}`) };
  } catch (e) {
    if (status(e) === 404) return { status: "closed", evidence: "Workday: job posting not found", url, via: "workday-api" };
    throw e;
  }
}

/** apply.workable.com/[<account>/]j/<code>: without the account, the page redirect names it. */
async function workable(url: string, get: Get): Promise<LivenessCheck> {
  let final = url;
  let m = final.match(/apply\.workable\.com\/([^/]+)\/j\/([A-Z0-9]+)/i);
  if (!m) {
    const r = await get(url, { source: "liveness", noSnapshot: true, retries: 1 }).catch((e) => e as FetchError);
    if (r instanceof Error) return status(r) === 404 ? { status: "closed", evidence: "HTTP 404", url, via: "workable-api" } : { status: "unknown", evidence: r.message, url, via: "workable-api" };
    final = r.finalUrl ?? url;
    m = final.match(/apply\.workable\.com\/([^/]+)\/j\/([A-Z0-9]+)/i);
    if (!m) return { status: "closed", evidence: `Workable redirected away from the job (${final.slice(0, 60)})`, url, via: "workable-api" };
  }
  try {
    const r = await get(`https://apply.workable.com/api/v2/accounts/${m[1]}/jobs/${m[2]}`, { source: "liveness", noSnapshot: true, retries: 1 });
    return { status: "open", evidence: `listed on ${m[1]}'s Workable board`, url, via: "workable-api", mentionsIntake: intakeRe().test(r.body) };
  } catch (e) {
    if (status(e) === 404) return { status: "closed", evidence: "Workable: job not found", url, via: "workable-api" };
    throw e;
  }
}

// ---------- any other page ----------

async function page(url: string, get: Get): Promise<LivenessCheck> {
  let r: FetchResult;
  try {
    r = await get(url, { source: "liveness", noSnapshot: true, retries: 1 });
  } catch (e) {
    const s = status(e);
    if (s === 404 || s === 410) return { status: "closed", evidence: `HTTP ${s} — posting removed`, url, via: "page" };
    return { status: "unknown", evidence: s ? `HTTP ${s} (blocked or rate-limited)` : (e as Error).message.slice(0, 80), url, via: "page" };
  }
  if (/[?&]error=true/.test(r.finalUrl ?? "")) return { status: "closed", evidence: "redirected to the job board (job not found)", url, via: "page" };
  const text = htmlToText(r.body);
  const m = text.match(CLOSED);
  if (m) return { status: "closed", evidence: `page says "${snippet(text, m)}"`, url, via: "page" };
  if (text.length < 300) return { status: "unknown", evidence: "page renders in the browser; nothing to read", url, via: "page" };
  // a board's own nav says "2027 graduate schemes" on every page, so only an employer page can confirm the intake
  const board = BOARD_HOSTS.test(new URL(url).host);
  return { status: "open", evidence: "page live, no closing notice", url, via: "page", mentionsIntake: !board && intakeRe().test(text) };
}

const BOARD_HOSTS = /(targetjobs\.co\.uk|brightnetwork\.co\.uk|higherin\.com|linkedin\.com|indeed\.com|gradcracker\.com|milkround\.com)$/;
export const isBoardUrl = (url: string) => { try { return BOARD_HOSTS.test(new URL(url).host); } catch { return false; } };
