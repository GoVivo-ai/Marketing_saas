/**
 * Adds the per-user RingCentral columns to `users`. Idempotent.
 * Run: npx tsx scripts/migrate-ringcentral.ts
 * (drizzle-kit push is broken in this repo, so we ALTER directly.)
 */
process.loadEnvFile(".env.local");

import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

  await sql`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS rc_access_token_enc text,
      ADD COLUMN IF NOT EXISTS rc_refresh_token_enc text,
      ADD COLUMN IF NOT EXISTS rc_token_expires_at timestamp,
      ADD COLUMN IF NOT EXISTS rc_refresh_token_expires_at timestamp,
      ADD COLUMN IF NOT EXISTS rc_from_number text,
      ADD COLUMN IF NOT EXISTS rc_owner_id text,
      ADD COLUMN IF NOT EXISTS rc_connected_at timestamp
  `;
  console.log("RingCentral columns ensured.");

  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'users' AND column_name LIKE 'rc_%'
    ORDER BY column_name
  `;
  console.log("rc_* columns now present:", cols.map((c) => c.column_name));

  await sql.end();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
