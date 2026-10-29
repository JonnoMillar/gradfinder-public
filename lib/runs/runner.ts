/**
 * The runner: polls for queued runs and runs each as a headless `claude -p` session (lib/runs/launch.ts).
 *
 * Started in-app by instrumentation.ts, so it is up whenever gradfinder is, and also by `npm run runner`. One run at a
 * time (one browser profile): `claimNext` is atomic, so two runners can never take the same run. The runner keeps a
 * running run's heartbeat alive, kills its process at the 30-minute cap, and fails the run if the process ends without
 * a result. Subscription-backed Claude sessions only, never the Anthropic API.
 *
 * Apply runs work in a headed Chrome the runner owns (lib/runs/browser.ts): opened before the pass, left open when it
 * ends, guard released once a pass ends at `ready` (so Jonno can submit by hand), closed when no apply run wants it.
 *
 *   RUNNER_DRIVER=claude    (default) spawn `claude -p`; needs `claude login` once
 *   RUNNER_DRIVER=external  housekeeping only; a Claude scheduled task claims runs with `npm run runq -- claim`
 *   RUNNER_DRIVER=off       nothing
 *   RUNNER_POLL_MS=5000
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { browserWanted, CAP_MS, claimNext, fail, getRun, heartbeat, reap, readyApplyRun, type RunRow } from "./runs";
import { claudeArgs, prepareRun } from "./launch";
import { browserAlive, closeBrowser, ensureBrowser, releaseGuard } from "./browser";

const log = (m: string) => console.log(`[runner] ${new Date().toISOString()} ${m}`);

/** What a failed run's log tail means in plain words. */
export function explainExit(tail: string, code: number | null): string {
  if (/OAuth|authenticate|not logged in|please run \/?login/i.test(tail)) {
    return "Claude CLI is not logged in. Run `claude login` in a terminal, then press Apply again.";
  }
  return `Ended without a result (exit ${code}). ${tail}`.slice(0, 480);
}

export function startRunner(opts: { driver?: string; pollMs?: number } = {}): () => void {
  const g = globalThis as { __gfRunner?: () => void };
  if (g.__gfRunner) return g.__gfRunner; // dev hot-reload re-registers: keep one
  const driver = opts.driver ?? process.env.RUNNER_DRIVER ?? "claude";
  const pollMs = opts.pollMs ?? Number(process.env.RUNNER_POLL_MS ?? 5000);
  if (driver === "off") return () => {};
  let child: ChildProcess | null = null;
  let stopping = false;
  let starting = false; // a run is being set up (browser opening): don't claim another
  let browserBusy = false;

  /** Closes the run browser when nothing wants it. One at a time; errors are logged, never thrown into the tick. */
  async function tidyBrowser() {
    if (browserBusy || child || starting) return;
    browserBusy = true;
    try {
      if ((await browserAlive()) && !browserWanted()) {
        log("closing the run browser (no apply run wants it)");
        await closeBrowser();
      }
    } catch (e) {
      console.error("[runner] browser tidy:", e instanceof Error ? e.message : e);
    } finally {
      browserBusy = false;
    }
  }

  /** A pass ended with the form ready: nobody is driving the window now, so let Jonno submit. */
  async function handOver(run: RunRow) {
    try {
      const n = await releaseGuard();
      log(`run ${run.id} ready: submit guard released in ${n} frame(s); window raised`);
    } catch (e) {
      console.error("[runner] release guard:", e instanceof Error ? e.message : e);
    }
  }

  async function launch(run: RunRow) {
    starting = true;
    try {
      if (run.kind === "apply") await ensureBrowser();
    } catch (e) {
      starting = false;
      fail(run.id, e instanceof Error ? e.message : String(e));
      return;
    }
    const files = prepareRun(run);
    const logFile = path.join(files.dir, "log.txt");
    const out = fs.openSync(logFile, "a");
    log(`run ${run.id} (${run.kind}, job ${run.jobId}) starting; log ${logFile}`);
    const bin = process.env.CLAUDE_BIN ?? "claude";
    const pre: string[] = process.env.CLAUDE_BIN_ARGS ? JSON.parse(process.env.CLAUDE_BIN_ARGS) : [];
    // turbopackIgnore: a spawn with `cwd: process.cwd()` makes `next build` trace the whole project, data/ included, and
    // the build then fails on the run Chrome's locked profile files whenever that browser is open
    const p = spawn(/* turbopackIgnore: true */ bin, [...pre, ...claudeArgs(run, files)], { cwd: process.cwd(), stdio: ["ignore", out, out], windowsHide: true });
    child = p;
    starting = false;
    const beat = setInterval(() => heartbeat(run.id), 30_000);
    const cap = setTimeout(() => { log(`run ${run.id} hit the cap; killing`); p.kill(); }, CAP_MS);
    p.on("error", (e) => fail(run.id, `Could not start claude: ${e.message}`));
    p.on("close", (code) => {
      clearInterval(beat);
      clearTimeout(cap);
      child = null;
      const after = getRun(run.id);
      log(`run ${run.id} process exited ${code}; state ${after?.state}`);
      if (after?.state === "running") {
        const tail = fs.readFileSync(logFile, "utf8").slice(-400).replace(/\s+/g, " ");
        fail(run.id, explainExit(tail, code));
      } else if (after?.kind === "apply" && after.state === "ready") {
        void handOver(after);
      }
    });
  }

  function tick() {
    if (stopping) return;
    try {
      reap();
      if (driver !== "claude") return;
      if (child || starting) return;
      void tidyBrowser();
      // While a filled form waits in the window, another apply run would drive that same window: research only.
      const run = claimNext(undefined, readyApplyRun() ? ["research"] : undefined);
      if (run) void launch(run);
    } catch (e) {
      console.error("[runner]", e instanceof Error ? e.message : e);
    }
  }

  log(`up (driver ${driver}, poll ${pollMs} ms)`);
  const timer = setInterval(tick, pollMs);
  timer.unref?.();
  tick();
  const stop = () => {
    stopping = true;
    clearInterval(timer);
    child?.kill();
    g.__gfRunner = undefined;
  };
  g.__gfRunner = stop;
  return stop;
}
