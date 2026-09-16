process.loadEnvFile(".env.local");
import postgres from "postgres";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  console.log(await sql`SELECT u.name, c.direction, c.result, count(*)::int n, min(c.start_time) first, max(c.start_time) last
    FROM call_logs c JOIN users u ON u.id = c.user_id
    WHERE c.start_time >= '2026-09-03' AND c.start_time < '2026-09-04'
    GROUP BY 1,2,3 ORDER BY 1,2,3`);
  console.log(await sql`SELECT u.name, count(*)::int n, max(c.start_time) last FROM call_logs c JOIN users u ON u.id=c.user_id GROUP BY 1 ORDER BY 3 DESC`);
  console.log(await sql`SELECT to_number, duration_sec, result, start_time FROM call_logs c JOIN users u ON u.id=c.user_id WHERE u.name ILIKE 'Juliana%' AND c.start_time >= '2026-09-03' AND c.start_time < '2026-09-04' ORDER BY start_time DESC LIMIT 5`);
  await sql.end();
}
main();
