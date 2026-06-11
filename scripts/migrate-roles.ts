/**
 * Roles & per-client AI key migration. Idempotent.
 * Run: npx tsx scripts/migrate-roles.ts
 *
 * 1. Adds workspaces.anthropic_api_key_enc.
 * 2. Backfills one workspace "owner" per workspace that has members but none
 *    (promotes the earliest-created member) so client orgs have a manager.
 */
process.loadEnvFile(".env.local");

import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

  await sql`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS anthropic_api_key_enc text`;
  console.log("anthropic_api_key_enc column ensured.");

  const promoted = await sql`
    UPDATE workspace_members m
    SET role = 'owner'
    WHERE m.id = (
      SELECT m2.id FROM workspace_members m2
      WHERE m2.workspace_id = m.workspace_id
      ORDER BY m2.created_at ASC
      LIMIT 1
    )
    AND NOT EXISTS (
      SELECT 1 FROM workspace_members m3
      WHERE m3.workspace_id = m.workspace_id AND m3.role = 'owner'
    )
    RETURNING m.workspace_id
  `;
  console.log(`Promoted ${promoted.length} workspace owner(s).`);

  const summary = await sql`
    SELECT w.name,
           (w.anthropic_api_key_enc IS NOT NULL) AS has_ai_key,
           count(m.id) FILTER (WHERE m.role = 'owner') AS owners,
           count(m.id) AS members
    FROM workspaces w
    LEFT JOIN workspace_members m ON m.workspace_id = w.id
    GROUP BY w.id, w.name
    ORDER BY w.name
  `;
  console.log("\n=== Workspaces ===");
  for (const r of summary) {
    console.log(`- ${r.name}: members=${r.members} owners=${r.owners} ai_key=${r.has_ai_key}`);
  }

  await sql.end();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
