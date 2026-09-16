/**
 * Adds the delivery columns Ads Manager's "Delivery" column is built from:
 * effective_status (+ learning_stage on ad sets) and the flight schedule.
 * Existing rows stay null until the next sync fills them. Idempotent.
 * Run: npx tsx scripts/migrate-delivery-status.ts
 */
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db";

if (!process.env.DATABASE_URL) {
  process.loadEnvFile(".env.local");
}

async function main() {
  for (const table of ["campaigns", "adsets"]) {
    await db().execute(
      sql.raw(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "effective_status" text`,
      ),
    );
    await db().execute(
      sql.raw(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "start_time" timestamp`),
    );
    await db().execute(
      sql.raw(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "end_time" timestamp`),
    );
  }
  await db().execute(
    sql`ALTER TABLE "adsets" ADD COLUMN IF NOT EXISTS "learning_stage" text`,
  );
  console.log("delivery columns ready on campaigns + adsets");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
