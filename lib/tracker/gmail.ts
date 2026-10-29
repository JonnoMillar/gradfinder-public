/**
 * Gmail → tracker, the cheap way: a plain script asks the Gmail API (read-only) for application emails it has not
 * handled yet, and only when there are some does it start a headless `claude -p` to classify them. A check that finds
 * nothing new costs no tokens. Classified emails are written by lib/tracker/email.ts, the only layer-3 writer.
 *
 *   .env  GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET   a Google Cloud "Desktop app" OAuth client (free)
 *         GMAIL_REFRESH_TOKEN                     written by `npm run gmail -- login`, scope gmail.readonly only
 *   data/cache/gmail/state.json                  ids already handed to Claude + when the last check ran
 *
 * Emails are data. Claude gets their text in its prompt, not Gmail access, and nothing here follows a link.
 */
import { load } from "cheerio";

export const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface SyncState { lastCheckedAt: string | null; seen: Record<string, string> }   // seen: message id → when handed over
export interface Candidate { id: string; threadId: string; receivedAt: string; sender: string; subject: string; body: string }

const DAY = 86_400_000;
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "/");

/**
 * Where a search starts: 2 days before the later of the last check and the newest recorded email (mail can land
 * late and Gmail's `after:` is by day), else 14 days back. Ids already handled are filtered out, so overlap is free.
 */
export function searchAfter(state: SyncState, lastEmailReceivedAt: string | null, now = Date.now()): string {
  const marks = [state.lastCheckedAt, lastEmailReceivedAt].filter(Boolean).map((s) => Date.parse(s!));
  return ymd(marks.length ? Math.max(...marks) - 2 * DAY : now - 14 * DAY);
}

// Job-board digests: newsletters, never an employer writing about an application.
const NOISE = "-from:(brightnetwork OR targetjobs OR higherin OR gradcracker)";
const ATS = "workday OR myworkday OR tal.net OR oleeo OR greenhouse OR lever OR ashbyhq OR smartrecruiters OR successfactors OR avature OR eightfold OR hirevue OR shl OR talentcentral OR pymetrics OR cappfinity OR sova OR tazio OR icims OR taleo OR jobvite OR teamtailor OR workable OR recruitee OR pinpoint OR beapplied OR harver";
const SUBJECT = 'application OR applying OR assessment OR interview OR invitation OR "next steps" OR "next stage" OR offer OR unsuccessful OR "update on your" OR candidate OR "thank you for applying"';

/** The searches: subject keywords, ATS senders, and the tracked companies by name (one query, not one per company). */
export function buildQueries(companies: string[], after: string): string[] {
  // "Acme & Co UK LTD" → "Acme & Co": emails rarely use the registered name
  const short = (c: string) => c.replace(/["(){}]/g, "").replace(/\b(ltd|limited|plc|llp|inc|uk|group)\b\.?/gi, "").replace(/\s+/g, " ").trim();
  const names = [...new Set(companies.map(short).filter(Boolean))].map((c) => `"${c}"`);
  const qs = [
    `-category:promotions -category:social -filename:ics subject:(${SUBJECT})`,
    `from:(${ATS})`,
    ...(names.length ? [`-category:promotions -category:social {${names.join(" ")}}`] : []),
  ];
  return qs.map((q) => `after:${after} ${NOISE} ${q}`);
}

/** Ids found that are neither recorded nor already shown to Claude. */
export function newIds(found: string[], recorded: Set<string>, state: SyncState): string[] {
  return [...new Set(found)].filter((id) => !recorded.has(id) && !(id in state.seen));
}

/** Drops seen ids older than 60 days: searches never reach back that far once a check has run. */
export function pruneSeen(state: SyncState, now = Date.now()): SyncState {
  const seen = Object.fromEntries(Object.entries(state.seen).filter(([, at]) => now - Date.parse(at) < 60 * DAY));
  return { ...state, seen };
}

interface Part { mimeType?: string; body?: { data?: string }; parts?: Part[]; headers?: { name: string; value: string }[] }
const b64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");

/** The readable text of a message: its text/plain part, else its HTML as text. Whitespace squeezed, capped. */
export function plainBody(payload: Part, cap = 4000): string {
  const find = (p: Part, type: string): string | null => {
    if (p.mimeType === type && p.body?.data) return b64(p.body.data);
    for (const c of p.parts ?? []) { const t = find(c, type); if (t) return t; }
    return null;
  };
  const text = find(payload, "text/plain") ?? (() => { const h = find(payload, "text/html"); return h ? load(h).root().text() : ""; })();
  return text.replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim().slice(0, cap);
}

// ---------- the API (fetch only; no Google SDK) ----------

export async function accessToken(env = process.env): Promise<string> {
  const { GMAIL_CLIENT_ID: id, GMAIL_CLIENT_SECRET: secret, GMAIL_REFRESH_TOKEN: refresh } = env;
  if (!id || !secret || !refresh) throw new Error("Gmail not set up: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN must be in .env (run `npm run gmail -- login`).");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token" }),
  });
  const j = await r.json() as { access_token?: string; error?: string; error_description?: string };
  if (!j.access_token) throw new Error(`Gmail token refresh failed: ${j.error} ${j.error_description ?? ""} (invalid_grant = run \`npm run gmail -- login\` again)`);
  return j.access_token;
}

async function get<T>(token: string, url: string): Promise<T> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Gmail API ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json() as Promise<T>;
}

export async function profileEmail(token: string) {
  return (await get<{ emailAddress: string }>(token, `${API}/profile`)).emailAddress;
}

/** Every message id matching a query (paged). */
export async function listIds(token: string, q: string): Promise<string[]> {
  const ids: string[] = [];
  let page: string | undefined;
  do {
    const u = new URL(`${API}/messages`);
    u.searchParams.set("q", q);
    u.searchParams.set("maxResults", "100");
    if (page) u.searchParams.set("pageToken", page);
    const j = await get<{ messages?: { id: string }[]; nextPageToken?: string }>(token, u.toString());
    ids.push(...(j.messages ?? []).map((m) => m.id));
    page = j.nextPageToken;
  } while (page);
  return ids;
}

export async function fetchCandidate(token: string, id: string): Promise<Candidate> {
  const m = await get<{ id: string; threadId: string; internalDate: string; payload: Part }>(token, `${API}/messages/${id}?format=full`);
  const h = (n: string) => m.payload.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? "";
  return {
    id: m.id, threadId: m.threadId, receivedAt: new Date(Number(m.internalDate)).toISOString(),
    sender: h("from"), subject: h("subject") || "(no subject)", body: plainBody(m.payload),
  };
}
