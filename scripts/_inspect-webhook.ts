process.loadEnvFile(".env.local");
import postgres from "postgres";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const byDay = await sql`
    SELECT to_char(started_at, 'MM-DD') AS d, count(*)::int n,
           array_agg(DISTINCT to_char(started_at, 'HH24:MI')) AS horas
    FROM sync_runs WHERE started_at > now() - interval '7 days'
    GROUP BY 1 ORDER BY 1 DESC`;
  console.log("Syncs por día (últimos 7):");
  for (const r of byDay) console.log(`  ${r.d}: ${r.n} corridas → ${r.horas.slice(0,12).join(", ")}`);
  await sql.end();
}
main().catch((e)=>{console.error(e);process.exit(1);});
