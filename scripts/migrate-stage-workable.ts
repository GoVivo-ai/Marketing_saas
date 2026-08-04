/**
 * Adds stages.workable (leads here still need outreach; false → out of the
 * contact queue) and opts existing "Contractor Compliance"-style stages out.
 * Idempotent.
 */
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db";

if (!process.env.DATABASE_URL) {
  process.loadEnvFile(".env.local");
}

async function main() {
  await db().execute(
    sql`ALTER TABLE "stages" ADD COLUMN IF NOT EXISTS "workable" boolean NOT NULL DEFAULT true`,
  );
  const res = await db().execute(
    sql`UPDATE "stages" SET "workable" = false WHERE "kind" <> 'lost' AND "name" ILIKE '%compliance%' RETURNING "name", "workspace_id"`,
  );
  console.log("column added; stages opted out of the queue:", res);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
