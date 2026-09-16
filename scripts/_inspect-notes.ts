process.loadEnvFile(".env.local");
import postgres from "postgres";
const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const notes = await sql`
    SELECT e.type, e.payload, l.name, l.geo_city, coalesce(u.name,'?') AS who, e.created_at
    FROM lead_events e
    JOIN leads l ON l.id = e.lead_id
    LEFT JOIN adsets a ON a.id = l.adset_id
    LEFT JOIN users u ON u.id = e.user_id
    WHERE l.workspace_id = ${WS}
      AND (l.geo_city ILIKE '%vegas%' OR a.city_name ILIKE '%vegas%')
      AND e.payload::text ILIKE '%compliance%' OR
          (l.workspace_id = ${WS} AND (l.geo_city ILIKE '%vegas%' OR a.city_name ILIKE '%vegas%') AND e.payload::text ILIKE '%cc%')
    ORDER BY e.created_at DESC LIMIT 25`;
  console.log("Eventos de Vegas que mencionan CC/compliance:", notes.length);
  for (const r of notes) console.log(`  ${r.created_at.toISOString().slice(0,10)} ${r.who} [${r.type}] ${r.name}: ${JSON.stringify(r.payload).slice(0, 160)}`);

  // call outcomes distribution on vegas leads
  const outcomes = await sql`
    SELECT e.payload ->> 'outcome' AS outcome, count(*)::int AS n
    FROM lead_events e JOIN leads l ON l.id = e.lead_id
    LEFT JOIN adsets a ON a.id = l.adset_id
    WHERE l.workspace_id = ${WS} AND e.type = 'call'
      AND (l.geo_city ILIKE '%vegas%' OR a.city_name ILIKE '%vegas%')
    GROUP BY 1 ORDER BY n DESC`;
  console.log("\nOutcomes de llamadas en Vegas:", outcomes);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
