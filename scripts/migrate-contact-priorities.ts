/**
 * Creates contact_priorities + lead_priorities — the Contact Queue's
 * priority layer on top of lead scoring. Idempotent.
 * Run: npx tsx scripts/migrate-contact-priorities.ts
 */
process.loadEnvFile(".env.local");

import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  await sql`
    CREATE TABLE IF NOT EXISTS contact_priorities (
      id text PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name text NOT NULL,
      prompt text NOT NULL,
      campaign_id text REFERENCES campaigns(id) ON DELETE CASCADE,
      regions jsonb,
      since_days integer,
      agent_id text REFERENCES users(id) ON DELETE CASCADE,
      active boolean NOT NULL DEFAULT true,
      created_by_id text REFERENCES users(id) ON DELETE SET NULL,
      applied_at timestamp,
      applied_count integer NOT NULL DEFAULT 0,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS contact_priority_workspace_idx ON contact_priorities (workspace_id)`;
  await sql`
    CREATE TABLE IF NOT EXISTS lead_priorities (
      priority_id text NOT NULL REFERENCES contact_priorities(id) ON DELETE CASCADE,
      lead_id text NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      boost integer NOT NULL,
      reason text,
      created_at timestamp NOT NULL DEFAULT now()
    )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS lead_priority_unique ON lead_priorities (priority_id, lead_id)`;
  await sql`CREATE INDEX IF NOT EXISTS lead_priority_lead_idx ON lead_priorities (lead_id)`;
  console.log("contact_priorities + lead_priorities ready");
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
