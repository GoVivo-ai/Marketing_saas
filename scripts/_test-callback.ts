process.loadEnvFile(".env.local");
import postgres from "postgres";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const mode = process.argv[2];
  const [ws] = await sql`SELECT id FROM workspaces WHERE slug = 'demo'`;
  const [lead] = await sql`
    SELECT l.id, l.name FROM leads l JOIN stages s ON s.id = l.stage_id
    WHERE l.workspace_id = ${ws.id} AND s.kind = 'open' AND s.workable AND l.disqual_l1 IS NULL
    ORDER BY l.created_at DESC LIMIT 1`;
  const at = mode === "future" ? new Date(Date.now() + 26 * 3600e3) : mode === "past" ? new Date(Date.now() - 3600e3) : null;
  await sql`UPDATE leads SET call_back_at = ${at} WHERE id = ${lead.id}`;
  console.log(mode, lead.name, at?.toISOString() ?? "cleared");
  await sql.end();
}
main();
