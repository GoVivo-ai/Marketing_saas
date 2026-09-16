process.loadEnvFile(".env.local");
import postgres from "postgres";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  console.log(await sql`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'lead_events'`);
  console.log(await sql`SELECT count(*)::int AS n FROM lead_events`);
  console.log(await sql`EXPLAIN ANALYZE SELECT count(*) FROM leads l WHERE l.workspace_id = (SELECT id FROM workspaces WHERE slug='alexyah')
    AND coalesce((SELECT max(e.created_at) FROM lead_events e WHERE e.lead_id = l.id AND e.type='status_change' AND e.payload->>'toStageId' = l.stage_id), l.created_at) >= now() - interval '7 days'`);
  await sql.end();
}
main();
