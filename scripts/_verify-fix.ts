process.loadEnvFile(".env.local");
import postgres from "postgres";
const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63";
const CC = "1a88f4cc-40c8-4deb-9cd2-07e67ed068e3";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  for (const city of ["las vegas", "douglas county"]) {
    const rows = await sql`
      SELECT s.name AS stage, count(*)::int AS n
      FROM leads l
      LEFT JOIN adsets a ON a.id = l.adset_id
      LEFT JOIN stages s ON s.id = l.stage_id
      WHERE l.workspace_id = ${WS} AND (
        lower(btrim(l.geo_city)) = ${city}
        OR lower(btrim(a.city_name)) = ${city}
        OR lower(btrim(l.form_data ->> 'advertisement_area')) = ${city})
      GROUP BY 1 ORDER BY n DESC`;
    console.log(`\nPipeline con filtro "${city}" (lógica nueva):`);
    for (const r of rows) console.log(`  ${r.stage}: ${r.n}`);
  }
  const cc = await sql`
    SELECT count(*)::int AS n FROM leads WHERE workspace_id = ${WS} AND stage_id::text = ${CC}`;
  console.log("\nTotal In Contractor Compliance:", cc[0].n);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
