process.loadEnvFile(".env.local");
import postgres from "postgres";
const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63";
const CC = "1a88f4cc-40c8-4deb-9cd2-07e67ed068e3";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const reasons = await sql`
    SELECT coalesce(e.payload ->> 'reason', 'manual/drag') AS reason,
           date_trunc('month', e.created_at)::date AS month, count(*)::int AS n
    FROM lead_events e JOIN leads l ON l.id = e.lead_id
    WHERE l.workspace_id = ${WS} AND e.type = 'status_change'
      AND e.payload ->> 'toStageId' = ${CC}
    GROUP BY 1, 2 ORDER BY 2 DESC, n DESC`;
  console.log("Movimientos HACIA In Contractor Compliance por razón/mes:");
  for (const r of reasons) console.log(`  ${r.month.toISOString().slice(0,7)} ${r.reason}: ${r.n}`);
  const geoVegasAdsets = await sql`
    SELECT a.city_name, count(*)::int AS n FROM adsets a
    JOIN leads l ON l.adset_id = a.id
    WHERE l.workspace_id = ${WS} AND a.city_name ILIKE '%vegas%' GROUP BY 1`;
  console.log("Adsets con city_name Vegas:", geoVegasAdsets);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
