/**
 * Adds optional campaign period (start/end) to monthly plans. Idempotent.
 * Run: npx tsx scripts/migrate-planner-period.ts
 */
process.loadEnvFile(".env.local");
import postgres from "postgres";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  await sql`
    ALTER TABLE monthly_plans
      ADD COLUMN IF NOT EXISTS period_start date,
      ADD COLUMN IF NOT EXISTS period_end date
  `;
  console.log("monthly_plans period columns ensured.");
  await sql.end();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
