/**
 * Adds contact_priorities.cities — the audience's city filter. Idempotent.
 * Run: npx tsx scripts/migrate-contact-priority-cities.ts
 */
process.loadEnvFile(".env.local");

import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  await sql`ALTER TABLE contact_priorities ADD COLUMN IF NOT EXISTS cities jsonb`;
  console.log("contact_priorities.cities ready");
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
