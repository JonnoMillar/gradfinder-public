/**
 * The run browser: one headed Chrome that the RUNNER owns, not the agent.
 *
 * Why: a single-page form (Greenhouse, Lever, Ashby) saves nothing server-side, so its filled state lives only in the
 * browser window. When the Playwright MCP owned the browser, that window died with each `claude -p` pass. Now the
 * runner launches Chrome with a remote-debugging port and the agent's MCP attaches with `--cdp-endpoint`; the window
 * outlives the pass. At `ready` the runner disarms the submit guard in the open pages and brings the window forward, so
 * Jonno can review and press Submit by hand. The window closes when no apply run wants it (done, cancelled, failed,
 * 2 hours of waiting: runs.ts `browserWanted`).
 *
 * The debugging port binds 127.0.0.1 only. There is no auth on it: any local process could drive this browser (it holds
 * employer logins), which is the same exposure as the app itself (no auth, loopback only).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Its own profile (Chrome, not Playwright's bundled Chromium: a profile is not safe to share across browser builds). Gitignored via data/. */
export const PROFILE_DIR = path.join(process.cwd(), "data", "browser-profile-chrome");
export const CDP_PORT = Number(process.env.RUNNER_CDP_PORT ?? 9333);
export const cdpUrl = () => `http://127.0.0.1:${CDP_PORT}`;

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

export function chromePath(exists: (p: string) => boolean = fs.existsSync): string | null {
  const env = process.env.CHROME_PATH;
  if (env) return exists(env) ? env : null;
  return CHROME_CANDIDATES.find(exists) ?? null;
}

type Version = { Browser: string; webSocketDebuggerUrl: string };
async function version(): Promise<Version | null> {
  try {
    const r = await fetch(`${cdpUrl()}/json/version`, { signal: AbortSignal.timeout(1500) });
    return r.ok ? ((await r.json()) as Version) : null;
  } catch {
    return null;
  }
}
export const browserAlive = async () => (await version()) !== null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Opens the run browser if it is not already up. Resolves once its debugging port answers. */
export async function ensureBrowser(): Promise<void> {
  if (await browserAlive()) return;
  const exe = chromePath();
  if (!exe) throw new Error("No Chrome or Edge found for the run browser. Set CHROME_PATH to its executable.");
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const p = spawn(exe, [
    `--remote-debugging-port=${CDP_PORT}`, "--remote-debugging-address=127.0.0.1", `--user-data-dir=${PROFILE_DIR}`,
    "--no-first-run", "--no-default-browser-check", "about:blank",
  ], { detached: true, stdio: "ignore" });
  p.on("error", () => {});
  p.unref();
  for (let i = 0; i < 40; i++) {
    if (await browserAlive()) return;
    await sleep(500);
  }
  throw new Error(`The run browser did not open its debugging port ${CDP_PORT} within 20 s. Is another Chrome using ${PROFILE_DIR}?`);
}

// Minimal CDP client over Node's global WebSocket.
function session(wsUrl: string) {
  const ws = new WebSocket(wsUrl);
  let n = 0;
  type Reply = { result?: Record<string, unknown>; error?: { message: string } };
  const pending = new Map<number, (m: Reply) => void>();
  const listeners: ((m: { method?: string; params?: Record<string, unknown> }) => void)[] = [];
  const opened = new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error("CDP connect failed")); });
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
    else listeners.forEach((l) => l(m));
  };
  return {
    opened,
    on: (l: (typeof listeners)[number]) => listeners.push(l),
    send(method: string, params: Record<string, unknown> = {}) {
      const id = ++n;
      return new Promise<Reply>((res) => {
        pending.set(id, res);
        ws.send(JSON.stringify({ id, method, params }));
        setTimeout(() => { if (pending.delete(id)) res({ error: { message: `${method} timed out` } }); }, 4000);
      });
    },
    close: () => { try { ws.close(); } catch { /* already closed */ } },
  };
}

/**
 * Turns the submit guard off in every open page and frame, then raises the window. The guard was injected by the
 * agent's MCP as an init script; that script dies with the MCP, but the copy already running in each loaded document
 * keeps blocking Submit until told otherwise. Returns how many frames were released.
 */
export async function releaseGuard(): Promise<number> {
  let released = 0;
  const list = (await (await fetch(`${cdpUrl()}/json/list`, { signal: AbortSignal.timeout(3000) })).json()) as
    { type: string; webSocketDebuggerUrl?: string }[];
  const targets = list.filter((t) => (t.type === "page" || t.type === "iframe") && t.webSocketDebuggerUrl);
  for (const t of targets) {
    const s = session(t.webSocketDebuggerUrl!);
    try {
      await s.opened;
      const contexts: number[] = [];
      s.on((m) => { if (m.method === "Runtime.executionContextCreated") contexts.push(Number((m.params as { context: { id: number } }).context.id)); });
      await s.send("Runtime.enable");
      await sleep(250); // the contexts of the page and its same-process frames arrive as events
      for (const contextId of contexts) {
        const r = await s.send("Runtime.evaluate", { expression: "window.__gfGuardOff = true; true", contextId });
        if (!r.error) released++;
      }
      if (t.type === "page") await s.send("Page.bringToFront");
    } catch { /* a target that vanished is fine */ } finally {
      s.close();
    }
  }
  return released;
}

/** Opens a page in the run browser (a `login` card: the login Jonno does here is the one the next pass sees). */
export async function openInBrowser(url: string): Promise<void> {
  await ensureBrowser();
  const r = await fetch(`${cdpUrl()}/json/new?${encodeURIComponent(url)}`, { method: "PUT", signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`The run browser refused to open the page (${r.status})`);
}

/** Closes the run browser (Browser.close over CDP). Safe when it is already gone. */
export async function closeBrowser(): Promise<void> {
  const v = await version();
  if (!v) return;
  const s = session(v.webSocketDebuggerUrl);
  try {
    await s.opened;
    await s.send("Browser.close");
  } catch { /* closing kills the socket */ } finally {
    s.close();
  }
  for (let i = 0; i < 20 && (await browserAlive()); i++) await sleep(250);
}
