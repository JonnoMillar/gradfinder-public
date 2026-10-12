/**
 * Starts the Apply/Research runner inside the app (lib/runs/runner.ts), so runs Jonno queues start on their own
 * whenever gradfinder is up. It only ever acts on a run he queued. RUNNER_DRIVER=off disables it.
 * Demo mode never starts it. The hosted demo (DEMO_SEED_ON_START, next.config.ts) instead seeds its own database on
 * every cold start, so its dates are always relative to today; `register` finishes before the first request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.DEMO_SEED_ON_START === "1") {
    const { seedDemo } = await import("./demo/seed");
    await seedDemo((s) => console.log(`[demo] ${s}`));
  }
  if (process.env.NEXT_PUBLIC_DEMO === "1") return;
  const { startRunner } = await import("./lib/runs/runner");
  startRunner();
}
