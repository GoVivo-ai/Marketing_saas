/**
 * Creates the `monthly_plans` table. Idempotent.
 * Run: npx tsx scripts/migrate-planner.ts
 * (drizzle-kit push is broken in this repo, so we DDL directly.)
 */
process.loadEnvFile(".env.local");

import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

  await sql`
    CREATE TABLE IF NOT EXISTS monthly_plans (
      id text PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      month date NOT NULL,
      budget numeric(14,2) NOT NULL DEFAULT '0',
      target_cpl numeric(12,2) NOT NULL DEFAULT '0',
      conversion_rate numeric(6,4) NOT NULL DEFAULT '0',
      target_leads integer NOT NULL DEFAULT 0,
      target_sales integer NOT NULL DEFAULT 0,
      notes text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS monthly_plan_unique ON monthly_plans (workspace_id, month)`;

  console.log("monthly_plans table ensured.");
  await sql.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
