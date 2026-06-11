/**
 * Pipeline migration. Idempotent. Run: npx tsx scripts/migrate-pipeline.ts
 *
 * 1. Creates the `stages` table and `leads.stage_id`.
 * 2. Seeds 5 default stages per workspace (if it has none).
 * 3. Backfills each lead's stage_id from its current status enum.
 */
process.loadEnvFile(".env.local");

import { randomUUID } from "node:crypto";
import postgres from "postgres";

const DEFAULTS = [
  { name: "New", kind: "open", color: "#011640", position: 0, status: "new" },
  { name: "Contacted", kind: "open", color: "#026a60", position: 1, status: "contacted" },
  { name: "Qualified", kind: "open", color: "#04d98b", position: 2, status: "qualified" },
  { name: "Won", kind: "won", color: "#047a52", position: 3, status: "won" },
  { name: "Lost", kind: "lost", color: "#e5484d", position: 4, status: "lost" },
];

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

  await sql`
    CREATE TABLE IF NOT EXISTS stages (
      id text PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name text NOT NULL,
      color text,
      kind text NOT NULL DEFAULT 'open',
      position integer NOT NULL DEFAULT 0,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS stage_workspace_position_idx ON stages (workspace_id, position)`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS stage_id text REFERENCES stages(id) ON DELETE SET NULL`;
  console.log("stages table + leads.stage_id ensured.");

  const workspaces = await sql<{ id: string }[]>`SELECT id FROM workspaces`;
  let seeded = 0;
  for (const ws of workspaces) {
    const [{ count }] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM stages WHERE workspace_id = ${ws.id}
    `;
    if (count > 0) continue;

    // Insert defaults, remembering each stage id by its source status.
    const idByStatus: Record<string, string> = {};
    for (const d of DEFAULTS) {
      const id = randomUUID();
      idByStatus[d.status] = id;
      await sql`
        INSERT INTO stages (id, workspace_id, name, color, kind, position)
        VALUES (${id}, ${ws.id}, ${d.name}, ${d.color}, ${d.kind}, ${d.position})
      `;
    }
    // Backfill this workspace's leads from their status enum.
    for (const d of DEFAULTS) {
      await sql`
        UPDATE leads SET stage_id = ${idByStatus[d.status]}
        WHERE workspace_id = ${ws.id} AND status = ${d.status} AND stage_id IS NULL
      `;
    }
    seeded++;
  }
  console.log(`Seeded default stages for ${seeded} workspace(s).`);

  const summary = await sql`
    SELECT w.name,
           (SELECT count(*) FROM stages s WHERE s.workspace_id = w.id) AS stages,
           (SELECT count(*) FROM leads l WHERE l.workspace_id = w.id AND l.stage_id IS NOT NULL) AS leads_staged,
           (SELECT count(*) FROM leads l WHERE l.workspace_id = w.id) AS leads_total
    FROM workspaces w ORDER BY w.name
  `;
  console.log("\n=== Summary ===");
  for (const r of summary) {
    console.log(`- ${r.name}: stages=${r.stages} leads=${r.leads_staged}/${r.leads_total} staged`);
  }

  await sql.end();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
