/** Applies generated SQL migrations to data/app.db (or DB_PATH). */
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb, DB_PATH } from "../lib/db/client";

migrate(getDb(), { migrationsFolder: "./lib/db/migrations" });
console.log(`migrated ${DB_PATH}`);
