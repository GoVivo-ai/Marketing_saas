import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Lazily-initialized Drizzle client. The app boots without a DATABASE_URL;
 * anything that actually touches the DB throws a clear error instead of
 * crashing at import time.
 */
let _db: ReturnType<typeof createDb> | null = null;

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Configure Postgres in .env.local (see .env.example).",
    );
  }
  const client = postgres(url, { prepare: false });
  return drizzle(client, { schema });
}

export function db() {
  _db ??= createDb();
  return _db;
}

export const isDatabaseConfigured = () => Boolean(process.env.DATABASE_URL);

export * as schema from "./schema";
