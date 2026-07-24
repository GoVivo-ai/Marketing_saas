/**
 * Creates the `call_logs` table (RingCentral call history per user, matched
 * to leads by phone). Idempotent.
 * Run: npx tsx scripts/migrate-call-logs.ts
 * (drizzle-kit push is broken in this repo, so we CREATE directly.)
 */
process.loadEnvFile(".env.local");

import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

  await sql`
    CREATE TABLE IF NOT EXISTS call_logs (
      id text PRIMARY KEY,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider text NOT NULL DEFAULT 'ringcentral',
      external_id text NOT NULL,
      direction text,
      from_number text,
      to_number text,
      start_time timestamp NOT NULL,
      duration_sec integer NOT NULL DEFAULT 0,
      result text,
      lead_id text REFERENCES leads(id) ON DELETE SET NULL,
      workspace_id text REFERENCES workspaces(id) ON DELETE SET NULL,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS call_log_external_unique
      ON call_logs (user_id, external_id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS call_log_user_start_idx
      ON call_logs (user_id, start_time)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS call_log_workspace_start_idx
      ON call_logs (workspace_id, start_time)
  `;
  console.log("call_logs table ensured.");

  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'call_logs' ORDER BY ordinal_position
  `;
  console.log("columns:", cols.map((c) => c.column_name).join(", "));

  await sql.end();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
