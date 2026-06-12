/**
 * Adds the configurable result label to workspaces and the per-city plan
 * targets table. Idempotent. Run: npx tsx scripts/migrate-planner-cities.ts
 * (drizzle-kit push is broken in this repo, so we DDL directly.)
 */
process.loadEnvFile(".env.local");

import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

  await sql`
    ALTER TABLE workspaces
      ADD COLUMN IF NOT EXISTS result_label text NOT NULL DEFAULT 'Sales'
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS plan_city_targets (
      id text PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      month date NOT NULL,
      city_name text NOT NULL,
      target_results integer NOT NULL DEFAULT 0
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS plan_city_unique ON plan_city_targets (workspace_id, month, city_name)`;

  console.log("result_label + plan_city_targets ensured.");
  await sql.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
