/**
 * Creates the "Vivo" workspace — Vivo as a client of its own platform, where
 * applicants from govivo.ai/careers land (see api/webhooks/applications).
 * Idempotent: re-running only adds what's missing.
 *
 * Run: npx tsx scripts/create-vivo-workspace.ts
 */
process.loadEnvFile(".env.local");
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const SLUG = "vivo";

// A recruiting pipeline: the team calls, screens, interviews, and hires.
const STAGES = [
  { name: "New", color: "#ffffff", kind: "open", workable: true },
  { name: "Attempted to Contact", color: "#eea811", kind: "open", workable: true },
  { name: "Contacted", color: "#04c9d7", kind: "open", workable: true },
  { name: "Interview", color: "#054bf0", kind: "open", workable: false },
  { name: "Offer", color: "#0aeb42", kind: "open", workable: false },
  { name: "Hired", color: "#047a52", kind: "won", workable: false },
  { name: "Lost - Do Not Contact", color: "#e5484d", kind: "lost", workable: true },
];

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

  let [ws] = await sql<{ id: string }[]>`SELECT id FROM workspaces WHERE slug = ${SLUG}`;
  if (ws) {
    console.log(`Workspace "${SLUG}" already exists (${ws.id}).`);
  } else {
    [ws] = await sql<{ id: string }[]>`
      INSERT INTO workspaces (id, name, slug, industry, result_label, accent_color, is_active)
      VALUES (${randomUUID()}, 'Vivo', ${SLUG}, 'Staffing', 'Hires', '#011640', true)
      RETURNING id`;
    console.log(`Created workspace "Vivo" (${ws.id}).`);
  }

  const existing = await sql<{ name: string }[]>`
    SELECT name FROM stages WHERE workspace_id = ${ws.id}`;
  if (existing.length) {
    console.log(`Stages already present: ${existing.map((s) => s.name).join(", ")}`);
  } else {
    for (const [position, s] of STAGES.entries()) {
      await sql`
        INSERT INTO stages (id, workspace_id, name, color, kind, workable, position)
        VALUES (${randomUUID()}, ${ws.id}, ${s.name}, ${s.color}, ${s.kind}, ${s.workable}, ${position})`;
    }
    console.log(`Seeded ${STAGES.length} stages.`);
  }
  await sql.end();
}
main();
