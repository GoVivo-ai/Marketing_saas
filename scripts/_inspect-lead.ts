process.loadEnvFile(".env.local");
import postgres from "postgres";
const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63";
const q = process.argv[2] ?? "";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const rows = await sql`
    SELECT l.*, s.name AS stage_name, s.position AS stage_pos, a.city_name AS adset_city, c.name AS campaign
    FROM leads l
    LEFT JOIN stages s ON s.id = l.stage_id
    LEFT JOIN adsets a ON a.id = l.adset_id
    LEFT JOIN campaigns c ON c.id = l.campaign_id
    WHERE l.workspace_id = ${WS}
      AND (l.name ILIKE ${"%" + q + "%"} OR l.email ILIKE ${"%" + q + "%"} OR l.phone ILIKE ${"%" + q + "%"})
    ORDER BY l.created_at DESC`;
  console.log(`MATCHES para "${q}": ${rows.length}`);
  for (const l of rows) {
    console.log(`\n── ${l.name} (${l.id})`);
    console.log(`   email=${l.email} phone=${l.phone} platform=${l.platform}`);
    console.log(`   ETAPA: ${l.stage_name ?? "<< SIN ETAPA >>"} (pos ${l.stage_pos}) | status=${l.status}`);
    console.log(`   created=${l.created_at?.toISOString()} updated=${l.updated_at?.toISOString()}`);
    console.log(`   geo_city=${JSON.stringify(l.geo_city)} geo_region=${JSON.stringify(l.geo_region)} adset_city=${JSON.stringify(l.adset_city)} area=${JSON.stringify((l.form_data as any)?.advertisement_area)}`);
    console.log(`   campaign=${l.campaign} adset_id=${l.adset_id} assigned_to=${l.assigned_to_id} disqual=${l.disqual_l1}/${l.disqual_l2}/${l.disqual_l3}`);
    const ev = await sql`
      SELECT e.created_at, e.type, e.payload, u.name AS who
      FROM lead_events e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.lead_id = ${l.id} ORDER BY e.created_at`;
    console.log(`   EVENTOS (${ev.length}):`);
    for (const e of ev)
      console.log(`     ${e.created_at.toISOString().slice(0,16)} [${e.type}] ${e.who ?? "system"} :: ${JSON.stringify(e.payload).slice(0,220)}`);
  }
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
