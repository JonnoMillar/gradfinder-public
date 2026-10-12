import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";
import { locationBucket } from "@/lib/pipeline/normalise";

export const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "data", "app.db");

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database.Database | null = null;

/** Singleton connection. WAL so the UI can read while a sweep writes. */
export function getDb() {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  _sqlite = new Database(DB_PATH);
  _sqlite.pragma("journal_mode = WAL");
  _sqlite.pragma("foreign_keys = ON");
  // `is_london(location_raw)` for the UI's London column and filter: the same rule the keep/drop filter uses
  // (LONDON_PATTERNS, incl. outer boroughs), so "London" in the list means exactly what it means in filter.ts.
  _sqlite.function("is_london", { deterministic: true }, (raw: unknown) =>
    locationBucket(typeof raw === "string" ? raw : null) === "london" ? 1 : 0);
  _db = drizzle(_sqlite, { schema });
  return _db;
}

export function getSqlite() {
  getDb();
  return _sqlite!;
}

export { schema };
