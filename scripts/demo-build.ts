/**
 * Production build of the hosted demo (Vercel's build command, vercel.json). Sets GRADFINDER_HOSTED_DEMO so
 * next.config.ts bakes in demo mode, then runs `next build`. Env is set here because Windows npm scripts can't prefix it.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const next = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const r = spawnSync(process.execPath, [next, "build"], { stdio: "inherit", env: { ...process.env, GRADFINDER_HOSTED_DEMO: "1" } });
process.exitCode = r.status ?? 1;
