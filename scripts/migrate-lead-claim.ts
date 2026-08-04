/**
 * Adds the soft-claim columns (leads.working_by_id / working_at) so agents
 * see when someone else is already working a lead. Idempotent.
 */
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db";

if (!process.env.DATABASE_URL) {
  process.loadEnvFile(".env.local");
}

async function main() {
  await db().execute(
    sql`ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "working_by_id" text REFERENCES "users"("id") ON DELETE SET NULL`,
  );
  await db().execute(
    sql`ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "working_at" timestamp`,
  );
  console.log("lead claim columns added");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
