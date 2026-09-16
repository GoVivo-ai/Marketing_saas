process.loadEnvFile(".env.local");
import postgres from "postgres";
const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

  // Human status_change destinations on Vegas leads
  const dest = await sql`
    SELECT coalesce(u.name, 'sistema') AS who, st.name AS to_stage,
           coalesce(e.payload ->> 'reason', 'manual') AS reason, count(*)::int AS n
    FROM lead_events e
    JOIN leads l ON l.id = e.lead_id
    LEFT JOIN adsets a ON a.id = l.adset_id
    LEFT JOIN users u ON u.id = e.user_id
    LEFT JOIN stages st ON st.id::text = e.payload ->> 'toStageId'
    WHERE e.type = 'status_change'
      AND (l.geo_city ILIKE '%vegas%' OR a.city_name ILIKE '%vegas%')
    GROUP BY 1, 2, 3 ORDER BY n DESC`;
  console.log("STATUS_CHANGE en leads de Vegas — destino:");
  for (const r of dest) console.log(`  ${r.who} -> ${r.to_stage} (${r.reason}): ${r.n}`);

  // Leads that were EVER moved to CC but are no longer there (whole workspace)
  const reverted = await sql`
    SELECT l.name, l.geo_city, st.name AS current_stage, max(e.created_at) AS cc_at
    FROM lead_events e
    JOIN leads l ON l.id = e.lead_id
    LEFT JOIN stages st ON st.id = l.stage_id
    WHERE l.workspace_id = ${WS} AND e.type = 'status_change'
      AND e.payload ->> 'toStageId' = '1a88f4cc-40c8-4deb-9cd2-07e67ed068e3'
      AND l.stage_id::text <> '1a88f4cc-40c8-4deb-9cd2-07e67ed068e3'
    GROUP BY 1, 2, 3 ORDER BY cc_at DESC LIMIT 20`;
  console.log("\nLEADS que pasaron por CC y ya NO están en CC:", reverted.length);
  for (const r of reverted) console.log(`  ${r.name} (${r.geo_city}) ahora=${r.current_stage} cc=${r.cc_at.toISOString().slice(0,10)}`);

  // Human moves to Interested (is that their 'CC' proxy?)
  const interested = await sql`
    SELECT st.name AS to_stage, count(*)::int AS n
    FROM lead_events e
    JOIN leads l ON l.id = e.lead_id JOIN users u ON u.id = e.user_id
    LEFT JOIN stages st ON st.id::text = e.payload ->> 'toStageId'
    WHERE l.workspace_id = ${WS} AND e.type = 'status_change'
      AND e.created_at > now() - interval '30 days'
    GROUP BY 1 ORDER BY n DESC`;
  console.log("\nDestinos de status_change HUMANOS (30 días, todo AlexYah):");
  for (const r of interested) console.log(`  ${r.to_stage}: ${r.n}`);

  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
