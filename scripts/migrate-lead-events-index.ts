/**
 * Indexes lead_events by lead — the pipeline's "worked by" initial, the agent
 * filter and the "entered stage" date filter all look events up per lead,
 * and without this the table (23k+ rows) is seq-scanned once per lead.
 * Idempotent. Run: npx tsx scripts/migrate-lead-events-index.ts
 */
process.loadEnvFile(".env.local");

import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  await sql`
    CREATE INDEX IF NOT EXISTS lead_events_lead_type_created_idx
      ON lead_events (lead_id, type, created_at DESC)
  `;
  console.log("lead_events_lead_type_created_idx ready");
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
