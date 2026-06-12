/**
 * Adds lead ad-set attribution + geocoded location, and a geocoding cache.
 * Idempotent. Run: npx tsx scripts/migrate-lead-geo.ts
 * (drizzle-kit push is broken in this repo, so we DDL directly.)
 */
process.loadEnvFile(".env.local");

import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

  await sql`
    ALTER TABLE leads
      ADD COLUMN IF NOT EXISTS adset_id text REFERENCES adsets(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS geo_city text,
      ADD COLUMN IF NOT EXISTS geo_lat numeric(9,6),
      ADD COLUMN IF NOT EXISTS geo_lng numeric(9,6)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS geocache (
      query text PRIMARY KEY,
      lat numeric(9,6) NOT NULL,
      lng numeric(9,6) NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `;

  console.log("lead geo columns + geocache table ensured.");
  await sql.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
