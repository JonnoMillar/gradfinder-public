/**
 * npm run runner — the run queue's runner as a standalone process (lib/runs/runner.ts documents it).
 * Normally unnecessary: the app starts the same runner itself (instrumentation.ts). Use this when the dev server is
 * not running, or with RUNNER_DRIVER=external for housekeeping only.
 */
import { startRunner } from "../lib/runs/runner";

const stop = startRunner();
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stop();
    process.exitCode = 0;
  });
}
// The poll timer is unref'd for the in-app case; keep this process alive.
setInterval(() => {}, 1 << 30);
