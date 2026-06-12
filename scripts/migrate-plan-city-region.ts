/**
 * Adds the state/region to plan city targets and backfills it from synced
 * ad sets where the city name matches.
 * Idempotent. Run: npx tsx scripts/migrate-plan-city-region.ts
 * (drizzle-kit push is broken in this repo, so we DDL directly.)
 */
process.loadEnvFile(".env.local");

import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

  await sql`
    ALTER TABLE plan_city_targets
      ADD COLUMN IF NOT EXISTS region text
  `;
  await sql`
    UPDATE plan_city_targets t
      SET region = a.city_region
      FROM adsets a
      WHERE t.region IS NULL
        AND a.city_region IS NOT NULL
        AND a.workspace_id = t.workspace_id
        AND lower(a.city_name) = lower(t.city_name)
  `;

  console.log("plan_city_targets.region ensured.");
  await sql.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
