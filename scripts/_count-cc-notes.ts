process.loadEnvFile(".env.local");
import postgres from "postgres";
const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63";
const CC = "1a88f4cc-40c8-4deb-9cd2-07e67ed068e3";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const rows = await sql`
    SELECT DISTINCT l.id, l.name, l.geo_city, a.city_name AS adset_city, s.name AS stage
    FROM leads l
    JOIN lead_events e ON e.lead_id = l.id
    LEFT JOIN adsets a ON a.id = l.adset_id
    LEFT JOIN stages s ON s.id = l.stage_id
    WHERE l.workspace_id = ${WS}
      AND l.stage_id::text <> ${CC}
      AND (
        e.payload ->> 'note' ~* '(cc profile|create.? cc|moved? to cc|in cc|compliance)'
        OR e.payload ->> 'text' ~* '(cc profile|create.? cc|moved? to cc|in cc|compliance)'
      )`;
  console.log("Leads con nota tipo CC pero fuera de la etapa CC:", rows.length);
  const byCity: Record<string, number> = {};
  for (const r of rows) {
    const c = r.adset_city ?? r.geo_city ?? "?";
    byCity[c] = (byCity[c] ?? 0) + 1;
  }
  console.log(Object.entries(byCity).sort((a, b) => b[1] - a[1]));
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
