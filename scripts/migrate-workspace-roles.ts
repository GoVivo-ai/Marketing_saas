/**
 * Workspace-role rename migration. Idempotent.
 * Run: npx tsx scripts/migrate-workspace-roles.ts
 *
 * Replaces the old workspace_role enum (owner | editor | viewer) with the
 * client-facing roles (admin | supervisor | agent):
 *   owner  → admin       editor → supervisor       viewer → agent
 */
process.loadEnvFile(".env.local");

import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

  const [{ exists }] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'workspace_role' AND e.enumlabel = 'admin'
    ) AS exists
  `;

  if (exists) {
    console.log("workspace_role already uses the new values — nothing to do.");
  } else {
    await sql.begin(async (tx) => {
      await tx`ALTER TABLE workspace_members ALTER COLUMN role DROP DEFAULT`;
      await tx`ALTER TABLE workspace_members ALTER COLUMN role TYPE text`;
      await tx`
        UPDATE workspace_members SET role = CASE role
          WHEN 'owner' THEN 'admin'
          WHEN 'editor' THEN 'supervisor'
          ELSE 'agent'
        END
      `;
      await tx`DROP TYPE workspace_role`;
      await tx`CREATE TYPE workspace_role AS ENUM ('admin', 'supervisor', 'agent')`;
      await tx`
        ALTER TABLE workspace_members
        ALTER COLUMN role TYPE workspace_role USING role::workspace_role
      `;
      await tx`ALTER TABLE workspace_members ALTER COLUMN role SET DEFAULT 'agent'`;
    });
    console.log("workspace_role migrated: owner→admin, editor→supervisor, viewer→agent.");
  }

  const summary = await sql`
    SELECT w.name, m.role, count(*) AS n
    FROM workspace_members m
    JOIN workspaces w ON w.id = m.workspace_id
    GROUP BY w.name, m.role
    ORDER BY w.name, m.role
  `;
  console.log("\n=== Memberships ===");
  for (const r of summary) console.log(`- ${r.name}: ${r.role} × ${r.n}`);

  await sql.end();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
