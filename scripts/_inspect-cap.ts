process.loadEnvFile(".env.local");
import postgres from "postgres";
const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63";
const CC = "1a88f4cc-40c8-4deb-9cd2-07e67ed068e3";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const rank = await sql`
    SELECT n FROM (
      SELECT id, row_number() OVER (ORDER BY created_at DESC) AS n
      FROM leads WHERE workspace_id = ${WS} AND stage_id = ${CC}
    ) t WHERE id = '2c8175b4-4851-4c27-a66d-00840b5f194c'`;
  console.log("Posición de Jovanny en la columna CC (orden created_at desc):", rank[0]?.n, "de 247 — cap =", 100);

  const months = await sql`
    SELECT to_char(created_at, 'YYYY-MM') AS m, count(*)::int AS n
    FROM leads WHERE workspace_id = ${WS} AND stage_id = ${CC}
    GROUP BY 1 ORDER BY 1 DESC`;
  console.log("\nLeads en CC por mes de CREACIÓN:", months.map(r => `${r.m}:${r.n}`).join("  "));

  const moved = await sql`
    SELECT to_char(e.created_at, 'YYYY-MM') AS m, count(DISTINCT e.lead_id)::int AS n
    FROM lead_events e JOIN leads l ON l.id = e.lead_id
    WHERE l.workspace_id = ${WS} AND e.type = 'status_change'
      AND e.payload ->> 'toStageId' = ${CC}
    GROUP BY 1 ORDER BY 1 DESC`;
  console.log("Movimientos A la etapa CC por mes:", moved.map(r => `${r.m}:${r.n}`).join("  "));

  const cities = await sql`
    SELECT coalesce(a.city_name,'∅') AS adset_city, coalesce(l.geo_city,'∅') AS geo_city, count(*)::int AS n
    FROM leads l LEFT JOIN adsets a ON a.id = l.adset_id
    WHERE l.workspace_id = ${WS} AND l.stage_id = ${CC}
    GROUP BY 1,2 ORDER BY n DESC LIMIT 25`;
  console.log("\nCC por ciudad (adset vs geo):");
  for (const r of cities) console.log(`  adset=${r.adset_city} | geo=${r.geo_city} → ${r.n}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
