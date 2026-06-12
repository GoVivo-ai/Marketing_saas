/**
 * Adds the radius-boost column to leads: the part of ai_score earned for
 * being inside the ad set's audience radius. Keeping it separate makes the
 * boost recomputable (ai_score - radius_boost = base AI score).
 * Idempotent. Run: npx tsx scripts/migrate-lead-radius-boost.ts
 * (drizzle-kit push is broken in this repo, so we DDL directly.)
 */
process.loadEnvFile(".env.local");

import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

  await sql`
    ALTER TABLE leads
      ADD COLUMN IF NOT EXISTS radius_boost integer NOT NULL DEFAULT 0
  `;

  console.log("leads.radius_boost ensured.");
  await sql.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
