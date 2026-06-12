/**
 * Planner v2: blank-canvas + named plans. A workspace can now keep any number
 * of named plans (the one-plan-per-month unique constraint is dropped) and
 * city targets are keyed to their plan instead of (workspace, month).
 * Idempotent. Run: npx tsx scripts/migrate-planner-named-plans.ts
 * (drizzle-kit push is broken in this repo, so we DDL directly.)
 */
process.loadEnvFile(".env.local");

import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

  // Custom, editable plan name. Existing plans get their month as the name.
  await sql`
    ALTER TABLE monthly_plans
      ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT ''
  `;
  await sql`
    UPDATE monthly_plans
      SET name = to_char(month, 'FMMonth YYYY')
      WHERE name = ''
  `;

  // Allow several plans per month — replace the unique with a plain index.
  await sql`DROP INDEX IF EXISTS monthly_plan_unique`;
  await sql`
    CREATE INDEX IF NOT EXISTS monthly_plan_workspace_month_idx
      ON monthly_plans (workspace_id, month)
  `;

  // City targets belong to a plan now, not to (workspace, month).
  await sql`
    ALTER TABLE plan_city_targets
      ADD COLUMN IF NOT EXISTS plan_id text REFERENCES monthly_plans(id) ON DELETE CASCADE
  `;
  await sql`
    UPDATE plan_city_targets t
      SET plan_id = p.id
      FROM monthly_plans p
      WHERE t.plan_id IS NULL
        AND p.workspace_id = t.workspace_id
        AND p.month = t.month
  `;
  // Targets whose plan no longer exists have nothing to attach to.
  await sql`DELETE FROM plan_city_targets WHERE plan_id IS NULL`;
  await sql`ALTER TABLE plan_city_targets ALTER COLUMN plan_id SET NOT NULL`;
  await sql`DROP INDEX IF EXISTS plan_city_unique`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS plan_city_unique
      ON plan_city_targets (plan_id, city_name)
  `;

  console.log("Named plans + plan-keyed city targets ensured.");
  await sql.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
