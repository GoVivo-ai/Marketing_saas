process.loadEnvFile(".env.local");
import postgres from "postgres";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const runs = await sql`SELECT started_at, finished_at, status, left(coalesce(error,''),200) AS error, stats::text
    FROM sync_runs ORDER BY started_at DESC LIMIT 8`;
  for (const r of runs) console.log(`${r.started_at.toISOString().slice(0,16)} ${r.status} ${r.error} ${String(r.stats).slice(0,150)}`);
  await sql.end();
}
main().catch((e)=>{console.error(e);process.exit(1);});
