/** Where are the Las Vegas / Douglas County leads and what does their management look like? */
process.loadEnvFile(".env.local");
import postgres from "postgres";

const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

  for (const term of ["%vegas%", "%douglas%"]) {
    const rows = await sql`
      SELECT s.name AS stage, l.status, l.platform, count(*)::int AS n
      FROM leads l LEFT JOIN stages s ON s.id = l.stage_id
      WHERE l.workspace_id = ${WS}
        AND (l.geo_city ILIKE ${term} OR l.form_data ->> 'advertisement_area' ILIKE ${term}
             OR l.geo_region ILIKE ${term})
      GROUP BY 1, 2, 3 ORDER BY n DESC`;
    console.log(`\n=== ${term} — por etapa/status/plataforma ===`);
    for (const r of rows) console.log(`  stage=${r.stage} status=${r.status} platform=${r.platform} n=${r.n}`);
  }

  // Distinct advertisement areas containing vegas/douglas (any casing/spacing)
  const areas = await sql`
    SELECT form_data ->> 'advertisement_area' AS area, count(*)::int AS n
    FROM leads WHERE workspace_id = ${WS} AND form_data ->> 'advertisement_area' IS NOT NULL
    GROUP BY 1 ORDER BY n DESC LIMIT 50`;
  console.log("\n=== advertisement_area distinct (top 50) ===");
  for (const r of areas) console.log(`  ${JSON.stringify(r.area)} n=${r.n}`);

  // Recent stage-change events on vegas leads: who is managing them?
  const ev = await sql`
    SELECT e.type, e.payload, e.created_at, l.name
    FROM lead_events e JOIN leads l ON l.id = e.lead_id
    WHERE l.workspace_id = ${WS}
      AND (l.geo_city ILIKE '%vegas%' OR l.form_data ->> 'advertisement_area' ILIKE '%vegas%')
      AND e.type = 'status_change'
    ORDER BY e.created_at DESC LIMIT 15`;
  console.log("\n=== últimos status_change en leads de Vegas ===");
  for (const r of ev) console.log(`  ${r.created_at.toISOString().slice(0, 10)} ${r.name}: ${JSON.stringify(r.payload)}`);

  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
