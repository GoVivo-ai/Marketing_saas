/**
 * Adds the per-user Dialpad columns to `users`. Idempotent.
 * Run: npx tsx scripts/migrate-dialpad.ts
 * (drizzle-kit push is broken in this repo, so we ALTER directly.)
 */
process.loadEnvFile(".env.local");

import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

  await sql`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS dp_access_token_enc text,
      ADD COLUMN IF NOT EXISTS dp_refresh_token_enc text,
      ADD COLUMN IF NOT EXISTS dp_token_expires_at timestamp,
      ADD COLUMN IF NOT EXISTS dp_refresh_token_expires_at timestamp,
      ADD COLUMN IF NOT EXISTS dp_from_number text,
      ADD COLUMN IF NOT EXISTS dp_user_id text,
      ADD COLUMN IF NOT EXISTS dp_connected_at timestamp
  `;
  console.log("Dialpad columns ensured.");

  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'users' AND column_name LIKE 'dp_%'
    ORDER BY column_name
  `;
  console.log("dp_* columns now present:", cols.map((c) => c.column_name));

  await sql.end();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
