/**
 * Adds rc_extensions — the RingCentral extension → user map the account-level
 * call log sync needs (its records name the caller only by extension id).
 * Idempotent. Run: npx tsx scripts/migrate-rc-extensions.ts
 */
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db";

if (!process.env.DATABASE_URL) {
  process.loadEnvFile(".env.local");
}

async function main() {
  await db().execute(sql`
    CREATE TABLE IF NOT EXISTS "rc_extensions" (
      "id" text PRIMARY KEY,
      "extension_id" text NOT NULL,
      "extension_number" text,
      "rc_name" text,
      "rc_email" text,
      "user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
      "matched_by" text NOT NULL DEFAULT 'auto',
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db().execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "rc_extension_unique" ON "rc_extensions" ("extension_id")`,
  );
  await db().execute(
    sql`CREATE INDEX IF NOT EXISTS "rc_extension_user_idx" ON "rc_extensions" ("user_id")`,
  );
  console.log("rc_extensions ready");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
