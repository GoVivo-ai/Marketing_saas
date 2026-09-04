/**
 * Creates api_keys: personal bearer tokens for the read-only MCP server.
 * Idempotent.
 */
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db";

if (!process.env.DATABASE_URL) {
  process.loadEnvFile(".env.local");
}

async function main() {
  await db().execute(sql`
    CREATE TABLE IF NOT EXISTS "api_keys" (
      "id" text PRIMARY KEY,
      "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "key_hash" text NOT NULL UNIQUE,
      "key_prefix" text NOT NULL,
      "last_used_at" timestamp,
      "revoked_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db().execute(
    sql`CREATE INDEX IF NOT EXISTS "api_key_user_idx" ON "api_keys" ("user_id")`,
  );
  console.log("api_keys ready");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
