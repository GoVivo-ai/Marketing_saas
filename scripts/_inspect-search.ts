process.loadEnvFile(".env.local");
import postgres from "postgres";
const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63";
const ID = "2c8175b4-4851-4c27-a66d-00840b5f194c";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const [l] = await sql`
    SELECT l.name, length(l.name) AS len, l.created_at, l.stage_id,
           a.city_name, a.city_region, a.name AS adset_name, l.geo_city, l.geo_region
    FROM leads l LEFT JOIN adsets a ON a.id = l.adset_id WHERE l.id = ${ID}`;
  console.log("Nombre:", JSON.stringify(l.name), "len:", l.len);
  console.log("adset:", l.adset_name, "| city_name:", JSON.stringify(l.city_name), "| city_region:", JSON.stringify(l.city_region));
  console.log("geo_city:", JSON.stringify(l.geo_city), "| geo_region:", JSON.stringify(l.geo_region));
  console.log("created_at:", l.created_at.toISOString());

  // ¿Cuántas opciones de ciudad hay y cuáles cubren a este lead?
  const opts = await sql`
    SELECT DISTINCT lower(btrim(city_name)) AS c FROM adsets WHERE workspace_id = ${WS} AND city_name IS NOT NULL ORDER BY 1`;
  console.log("\nCiudades de adset disponibles:", opts.map(o=>o.c).join(", "));
  const regions = await sql`
    SELECT city_region, count(*)::int AS n FROM adsets WHERE workspace_id = ${WS} GROUP BY 1 ORDER BY n DESC`;
  console.log("\nRegiones de adset (NULL = el lead se cae de cualquier filtro de estado):");
  for (const r of regions) console.log(`  ${JSON.stringify(r.city_region)}: ${r.n} adsets`);

  // Leads en CC que se caerían de un filtro de estado por adset sin región
  const noregion = await sql`
    SELECT count(*)::int AS n FROM leads l LEFT JOIN adsets a ON a.id = l.adset_id
    WHERE l.workspace_id = ${WS} AND l.stage_id = '1a88f4cc-40c8-4deb-9cd2-07e67ed068e3'
      AND (a.city_region IS NULL)`;
  console.log("\nLeads en CC cuyo adset NO tiene región (invisibles con filtro de estado):", noregion[0].n, "de 247");
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
