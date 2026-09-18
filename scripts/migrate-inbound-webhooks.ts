/**
 * Creates inbound_webhooks — one lead-intake URL per workspace, managed from
 * Settings → Connections. Idempotent.
 * Run: npx tsx scripts/migrate-inbound-webhooks.ts
 */
process.loadEnvFile(".env.local");

import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  await sql`
    CREATE TABLE IF NOT EXISTS inbound_webhooks (
      id text PRIMARY KEY,
      workspace_id text NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
      token text NOT NULL UNIQUE,
      slack_webhook_url text,
      received_count integer NOT NULL DEFAULT 0,
      last_received_at timestamp,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )`;
  console.log("inbound_webhooks ready");
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
