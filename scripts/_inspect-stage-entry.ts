process.loadEnvFile(".env.local");
import postgres from "postgres";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const rows = await sql`
    SELECT s.name, count(*)::int AS n
    FROM leads l JOIN stages s ON s.id = l.stage_id
    WHERE l.workspace_id = (SELECT id FROM workspaces WHERE slug = 'alexyah')
      AND coalesce((SELECT max(e.created_at) FROM lead_events e
                    WHERE e.lead_id = l.id AND e.type = 'status_change'
                      AND e.payload->>'toStageId' = l.stage_id), l.created_at)
          BETWEEN '2026-09-04' AND '2026-09-04 23:59:59'
    GROUP BY s.name, s.position ORDER BY s.position`;
  console.log("alexyah, entered stage on 2026-09-04:", rows);
  const created = await sql`
    SELECT s.name, count(*)::int AS n FROM leads l JOIN stages s ON s.id = l.stage_id
    WHERE l.workspace_id = (SELECT id FROM workspaces WHERE slug = 'alexyah')
      AND l.created_at BETWEEN '2026-09-04' AND '2026-09-04 23:59:59'
    GROUP BY s.name, s.position ORDER BY s.position`;
  console.log("alexyah, created on 2026-09-04:", created);
  await sql.end();
}
main();
