/**
 * Adds the RCA disqualification reason columns to leads (disqual_l1/l2/l3) —
 * the spreadsheet's RCA Lvl 1/2/3, captured when a lead is marked
 * lost/not-qualified. Idempotent.
 * Run: npx tsx scripts/migrate-lead-disqual.ts
 * (drizzle-kit push is broken in this repo, so we DDL directly.)
 */
process.loadEnvFile(".env.local");

import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS disqual_l1 text`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS disqual_l2 text`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS disqual_l3 text`;

  console.log("leads.disqual_l1/l2/l3 ensured.");
  await sql.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
