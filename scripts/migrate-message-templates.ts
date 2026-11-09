/**
 * Creates message_templates — reusable SMS/email texts per workspace that
 * agents pick from the Contact Queue and the lead page. Idempotent.
 * Run: npx tsx scripts/migrate-message-templates.ts
 */
process.loadEnvFile(".env.local");

import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  await sql`
    CREATE TABLE IF NOT EXISTS message_templates (
      id text PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      channel text NOT NULL,
      name text NOT NULL,
      subject text,
      body text NOT NULL,
      sort_order integer NOT NULL DEFAULT 0,
      created_by_id text REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS message_template_name_unique
      ON message_templates (workspace_id, channel, name)`;
  await sql`
    CREATE INDEX IF NOT EXISTS message_template_workspace_idx
      ON message_templates (workspace_id, channel)`;
  console.log("message_templates ready");
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
