process.loadEnvFile(".env.local");
import postgres from "postgres";
const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const overall = await sql`
    SELECT to_char(created_at,'YYYY-MM') AS m,
           count(*)::int total,
           count(ai_score)::int scored,
           count(*) FILTER (WHERE ai_score IS NULL)::int pending
    FROM leads WHERE workspace_id=${WS} GROUP BY 1 ORDER BY 1 DESC LIMIT 6`;
  console.log("Por mes (total/scored/pendientes):");
  for (const r of overall) console.log(`  ${r.m}: ${r.total} / ${r.scored} / ${r.pending}`);
  const recent = await sql`
    SELECT name, platform, created_at, ai_score, left(coalesce(ai_score_reason,''),60) AS reason
    FROM leads WHERE workspace_id=${WS} ORDER BY created_at DESC LIMIT 12`;
  console.log("\nÚltimos 12 leads:");
  for (const r of recent) console.log(`  ${r.created_at.toISOString().slice(0,16)} ${r.name} [${r.platform}] score=${r.ai_score ?? "NULL"} ${r.reason}`);
  await sql.end();
}
main().catch((e)=>{console.error(e);process.exit(1);});
