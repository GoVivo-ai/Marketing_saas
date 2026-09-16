process.loadEnvFile(".env.local");
import postgres from "postgres";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  console.log(await sql`SELECT direction, result, count(*)::int n, avg(duration_sec)::int avg FROM call_logs GROUP BY 1,2 ORDER BY 3 DESC`);
  console.log(await sql`SELECT workspace_id IS NULL AS no_ws, lead_id IS NULL AS no_lead, count(*)::int FROM call_logs GROUP BY 1,2`);
  console.log(await sql`SELECT u.name, date(e.created_at) d, count(*)::int n FROM lead_events e JOIN users u ON u.id=e.user_id
    WHERE e.type='status_change' AND e.payload->>'reason'='cc_activated' AND e.created_at >= '2026-09-01' GROUP BY 1,2 ORDER BY 2 DESC, 1 LIMIT 12`);
  console.log(await sql`SELECT start_time::text, to_number, duration_sec FROM call_logs c JOIN users u ON u.id=c.user_id WHERE u.name ILIKE 'Juliana%' AND c.external_id IS NOT NULL ORDER BY start_time DESC LIMIT 2`);
  await sql.end();
}
main();
