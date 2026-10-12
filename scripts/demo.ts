/**
 * Serves the demo (data/demo.db + demo/profile, the fictional Alex Morgan) with the run runner off, so nothing can act.
 * `npm run demo:seed` first. Env is set here because Windows npm scripts can't prefix it.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const db = path.join(process.cwd(), "data", "demo.db");
if (!fs.existsSync(db)) {
  console.error("data/demo.db is missing: run `npm run demo:seed` first");
  process.exitCode = 1;
} else {
  const next = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [next, "dev", "-H", "127.0.0.1", "-p", process.env.PORT ?? "3100"], {
    stdio: "inherit",
    env: { ...process.env, DB_PATH: db, PROFILE_DIR: "demo/profile", CV_FILE: "Alex Morgan CV.pdf",
      RUNNER_DRIVER: "off", NEXT_PUBLIC_DEMO: "1", NEXT_DIST_DIR: ".next-demo" },
  });
  child.on("exit", (code) => { process.exitCode = code ?? 0; });
}
