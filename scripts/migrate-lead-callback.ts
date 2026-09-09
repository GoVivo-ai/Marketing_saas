/**
 * Adds leads.call_back_at — the "call me back at …" the lead asked for, which
 * the Contact Queue honors as the follow-up due time. Idempotent.
 * Run: npx tsx scripts/migrate-lead-callback.ts
 */
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db";

if (!process.env.DATABASE_URL) {
  process.loadEnvFile(".env.local");
}

async function main() {
  await db().execute(
    sql`ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "call_back_at" timestamp`,
  );
  console.log("leads.call_back_at ready");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
