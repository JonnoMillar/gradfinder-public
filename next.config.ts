import type { NextConfig } from "next";
import os from "node:os";
import path from "node:path";

/**
 * The hosted demo (`npm run demo:build`, used by Vercel): demo mode with nothing to configure in a dashboard. These are
 * inlined at build time. The DB lives in the function's writable /tmp and is seeded on each cold start
 * (instrumentation.ts); the seed's inputs are traced into every server function below.
 */
const HOSTED = process.env.GRADFINDER_HOSTED_DEMO === "1";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // demo mode (scripts/demo.ts) builds into its own folder so it can run beside the real app: next dev locks its distDir
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  ...(HOSTED && {
    env: {
      NEXT_PUBLIC_DEMO: "1",
      DEMO_SEED_ON_START: "1",
      RUNNER_DRIVER: "off",
      DB_PATH: path.join(os.tmpdir(), "gradfinder-demo.db"),
      PROFILE_DIR: "demo/profile",
      CV_FILE: "Alex Morgan CV.pdf",
    },
    outputFileTracingIncludes: {
      "/**": ["./demo/catalogue.json", "./demo/profile/**/*", "./lib/db/migrations/**/*"],
    },
    // The demo is read-only and the same for everyone, but its pages are force-dynamic, so Next sends no-store and every
    // crawler hit cost a function run plus origin transfer (ClaudeBot at ~11 req/s used the Hobby quota, 2026-11-11).
    // Vercel-CDN-Cache-Control is read by Vercel's CDN only; browsers still see Next's own Cache-Control.
    async headers() {
      return [{ source: "/((?!_next/).*)", headers: [{ key: "Vercel-CDN-Cache-Control", value: "max-age=3600, stale-while-revalidate=86400" }] }];
    },
  }),
};

export default nextConfig;
