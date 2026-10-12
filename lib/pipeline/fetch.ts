/**
 * Shared HTTP client for every source and research fetcher.
 *  - retries transient failures (network errors, 429, 5xx) with exponential backoff
 *  - throttles per host so we behave (job boards reset connections if hammered)
 *  - writes an immutable snapshot (body on disk + row in `snapshots`) for provenance
 * Non-transient failures (404, 403) throw immediately — we want to hear about them.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDb, schema } from "@/lib/db/client";

export class FetchError extends Error {
  constructor(message: string, public readonly url: string, public readonly status?: number, cause?: unknown, public readonly retryAfterMs?: number) {
    super(message, { cause });
    this.name = "FetchError";
  }
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 gradfinder/0.1 (+personal job tracker)";
const RAW_DIR = process.env.RAW_DIR ?? path.join(process.cwd(), "data", "raw");

/** Minimum gap between requests to the same host, in ms. */
const HOST_MIN_GAP_MS: Record<string, number> = {
  "higherin.com": 350,
  "en.wikipedia.org": 1000,      // REST summary endpoint 429s at ~1 req/s bursts (2026-09-21)
  "html.duckduckgo.com": 6000,   // bursts of ~4 in a few minutes earned a 202 challenge (2026-09-21)
};
const DEFAULT_GAP_MS = 250;
const lastRequestAt = new Map<string, number>();
const hostQueues = new Map<string, Promise<void>>();

async function throttle(host: string) {
  // Serialise per host: chain onto the host's queue, then wait out the gap.
  const prev = hostQueues.get(host) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  hostQueues.set(host, prev.then(() => mine));
  await prev;
  const gap = HOST_MIN_GAP_MS[host] ?? DEFAULT_GAP_MS;
  const wait = (lastRequestAt.get(host) ?? 0) + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt.set(host, Date.now());
  release();
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FetchOptions {
  source: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  retries?: number;
  /** Skip writing a snapshot (e.g. for paginated API calls where the parsed result is what matters). */
  noSnapshot?: boolean;
}

export interface FetchResult {
  url: string;
  /** where redirects ended up; a closed posting often redirects to the board */
  finalUrl?: string;
  status: number;
  body: string;
  contentHash: string;
  snapshotId: number | null;
}

/** Fetch text with retry/throttle/snapshot. Throws FetchError when it gives up. */
export async function fetchText(url: string, opts: FetchOptions): Promise<FetchResult> {
  const { retries = 3, timeoutMs = 30_000 } = opts;
  const host = new URL(url).host;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(host);
    try {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        headers: { "user-agent": UA, accept: "text/html,application/json,application/xml;q=0.9,*/*;q=0.8", ...opts.headers },
        body: opts.body,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });
      const body = await res.text();
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get("retry-after"));
        throw new FetchError(`HTTP ${res.status}`, url, res.status, undefined, Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined);
      }
      if (!res.ok) {
        // 4xx other than 429: not transient, don't retry.
        throw new FetchError(`HTTP ${res.status}`, url, res.status);
      }
      const contentHash = sha256(body);
      const snapshotId = opts.noSnapshot ? null : writeSnapshot(url, opts.source, res.status, contentHash, body);
      return { url, finalUrl: res.url || url, status: res.status, body, contentHash, snapshotId };
    } catch (err) {
      lastErr = err;
      const transient = isTransient(err);
      if (!transient || attempt === retries) break;
      // A 429 with retry-after (Wikipedia sends one) is waited out exactly.
      const hinted = err instanceof FetchError ? err.retryAfterMs : undefined;
      await sleep(hinted ?? 500 * 2 ** attempt + Math.random() * 300);
    }
  }
  if (lastErr instanceof FetchError) throw lastErr;
  throw new FetchError(`fetch failed: ${describe(lastErr)}`, url, undefined, lastErr);
}

export async function fetchJson<T = unknown>(url: string, opts: FetchOptions): Promise<{ data: T; res: FetchResult }> {
  const r = await fetchText(url, { ...opts, headers: { accept: "application/json", ...opts.headers } });
  try {
    return { data: JSON.parse(r.body) as T, res: r };
  } catch (e) {
    throw new FetchError(`invalid JSON from ${url}`, url, r.status, e);
  }
}

function isTransient(err: unknown): boolean {
  if (err instanceof FetchError) return err.status === undefined || err.status === 429 || err.status >= 500;
  // undici/network errors: ECONNRESET, timeouts, etc.
  return true;
}

function describe(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}${err.cause ? ` (${String((err.cause as Error).message ?? err.cause)})` : ""}`;
  return String(err);
}

export function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function writeSnapshot(url: string, source: string, status: number, contentHash: string, body: string): number {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const bodyPath = path.join(RAW_DIR, `${contentHash.slice(0, 16)}.txt`);
  if (!fs.existsSync(bodyPath)) fs.writeFileSync(bodyPath, body);
  const db = getDb();
  const row = db.insert(schema.snapshots).values({ url, source, httpStatus: status, contentHash, bodyPath }).returning({ id: schema.snapshots.id }).get();
  return row.id;
}
