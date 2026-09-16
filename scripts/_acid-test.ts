process.loadEnvFile(".env.local");
import postgres from "postgres";
const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63";
const CC = "1a88f4cc-40c8-4deb-9cd2-07e67ed068e3";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const [aug] = await sql`
    SELECT count(DISTINCT e.lead_id)::int n FROM lead_events e JOIN leads l ON l.id=e.lead_id
    WHERE l.workspace_id=${WS} AND e.type='status_change' AND e.payload->>'toStageId'=${CC}
      AND e.created_at >= '2026-08-01'`;
  const [augParamount] = await sql`
    SELECT count(DISTINCT e.lead_id)::int n FROM lead_events e
    JOIN leads l ON l.id=e.lead_id LEFT JOIN adsets a ON a.id=l.adset_id
    WHERE l.workspace_id=${WS} AND e.type='status_change' AND e.payload->>'toStageId'=${CC}
      AND e.created_at >= '2026-08-01'
      AND (lower(btrim(a.city_name))='paramount' OR lower(btrim(l.geo_city))='paramount')`;
  const [inCcNow] = await sql`SELECT count(*)::int n FROM leads WHERE workspace_id=${WS} AND stage_id=${CC}`;
  console.log(`Movidos a CC en agosto: ${aug.n} | de Paramount: ${augParamount.n} | en la columna CC hoy: ${inCcNow.n}`);
  await sql.end();
}
main().catch((e)=>{console.error(e);process.exit(1);});
