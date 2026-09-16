/** Leads con señal de Contractor Compliance que no aparecen en el board. */
process.loadEnvFile(".env.local");
import postgres from "postgres";

const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

  const stages = await sql`
    SELECT id, name, kind, workable, position FROM stages
    WHERE workspace_id = ${WS} ORDER BY position`;
  console.log("STAGES:");
  for (const s of stages) console.log(`  ${s.position} ${s.name} (kind=${s.kind} workable=${s.workable}) ${s.id}`);
  const cc = stages.find((s) => /compliance/i.test(s.name));

  const byStage = await sql`
    SELECT coalesce(s.name, '<< SIN ETAPA >>') AS stage, count(*)::int AS n
    FROM leads l LEFT JOIN stages s ON s.id = l.stage_id
    WHERE l.workspace_id = ${WS} GROUP BY 1 ORDER BY n DESC`;
  console.log("\nLEADS POR ETAPA:");
  for (const r of byStage) console.log(`  ${r.stage}: ${r.n}`);

  // 1) Leads sin etapa: no salen en ninguna columna del board.
  const orphans = await sql`
    SELECT l.id, l.name, l.email, l.phone, l.status, l.platform, l.created_at,
           l.geo_city, l.form_data ->> 'advertisement_area' AS area,
           (SELECT count(*)::int FROM lead_events e WHERE e.lead_id = l.id) AS events
    FROM leads l
    WHERE l.workspace_id = ${WS} AND l.stage_id IS NULL
    ORDER BY l.created_at DESC LIMIT 60`;
  console.log(`\nLEADS SIN ETAPA (muestra ${orphans.length}):`);
  for (const r of orphans)
    console.log(`  ${r.created_at.toISOString().slice(0,10)} ${r.name} | ${r.email} | ${r.phone} | status=${r.status} plat=${r.platform} city=${r.geo_city ?? r.area} events=${r.events}`);

  // 2) Señal de CC en eventos (nota / resultado de llamada / cambio de estado).
  const ccSignal = await sql`
    SELECT l.id, l.name, l.email, coalesce(s.name, '<< SIN ETAPA >>') AS stage,
           l.status, l.created_at,
           max(e.created_at) AS last_signal,
           (array_agg(e.type ORDER BY e.created_at DESC))[1] AS ev_type,
           (array_agg(left(e.payload::text, 160) ORDER BY e.created_at DESC))[1] AS ev_payload
    FROM leads l
    LEFT JOIN stages s ON s.id = l.stage_id
    JOIN lead_events e ON e.lead_id = l.id
    WHERE l.workspace_id = ${WS}
      AND e.payload::text ~* '(contractor compliance|\\mcc\\M|profile created|next steps|a1s)'
      AND (l.stage_id IS DISTINCT FROM ${cc?.id ?? null})
    GROUP BY l.id, l.name, l.email, s.name, l.status, l.created_at
    ORDER BY last_signal DESC LIMIT 80`;
  console.log(`\nCON SEÑAL CC PERO FUERA DE LA ETAPA CC (${ccSignal.length}):`);
  for (const r of ccSignal)
    console.log(`  [${r.stage}] ${r.name} | ${r.email} | señal ${r.last_signal.toISOString().slice(0,10)} ${r.ev_type} :: ${String(r.ev_payload).replace(/\s+/g,' ')}`);

  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
