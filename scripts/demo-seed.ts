/**
 * Builds data/demo.db for `npm run demo` (demo/seed.ts does the work). Run: npm run demo:seed
 * Spec: docs/superpowers/specs/2026-10-12-public-showcase.md
 */
import path from "node:path";

process.env.DB_PATH = path.join(process.cwd(), "data", "demo.db"); // before anything opens lib/db/client

import("../demo/seed").then((m) => m.seedDemo()).catch((e) => { console.error(e); process.exit(1); });
