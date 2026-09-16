/**
 * Adds geocache.region — the state Nominatim places a geocoded city/ZIP in,
 * so the lead's own state can be derived without re-querying. Idempotent.
 * Run: npx tsx scripts/migrate-geocache-region.ts
 */
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db";

if (!process.env.DATABASE_URL) {
  process.loadEnvFile(".env.local");
}

async function main() {
  await db().execute(
    sql`ALTER TABLE "geocache" ADD COLUMN IF NOT EXISTS "region" text`,
  );
  console.log("geocache.region ready");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
