/** Leads que llegaron a la etapa CC y fueron sacados por el auto-avance. */
process.loadEnvFile(".env.local");
import postgres from "postgres";
const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63";
const CC = "1a88f4cc-40c8-4deb-9cd2-07e67ed068e3";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

  const out = await sql`
    SELECT s.name AS stage_actual, e.payload ->> 'reason' AS razon_salida, count(*)::int AS n
    FROM lead_events e
    JOIN leads l ON l.id = e.lead_id
    LEFT JOIN stages s ON s.id = l.stage_id
    WHERE l.workspace_id = ${WS}
      AND e.type = 'status_change' AND e.payload ->> 'fromStageId' = ${CC}
      AND l.stage_id IS DISTINCT FROM ${CC}
    GROUP BY 1, 2 ORDER BY n DESC`;
  console.log("SALIDAS de la etapa CC — dónde quedó el lead y por qué salió:");
  for (const r of out) console.log(`  ${r.stage_actual} ← razón "${r.razon_salida ?? "movimiento manual"}": ${r.n}`);

  const auto = await sql`
    SELECT count(DISTINCT l.id)::int AS n FROM lead_events e JOIN leads l ON l.id = e.lead_id
    WHERE l.workspace_id = ${WS} AND e.type = 'status_change'
      AND e.payload ->> 'fromStageId' = ${CC} AND e.payload ->> 'reason' = 'auto_contacted'
      AND l.stage_id IS DISTINCT FROM ${CC}`;
  console.log(`\nLEADS HOY FUERA DE CC QUE FUERON DEGRADADOS POR EL AUTO-AVANCE: ${auto[0].n}`);

  const sample = await sql`
    SELECT l.name, l.email, s.name AS stage, max(e.created_at) AS cuando,
           (SELECT u.name FROM lead_events e2 LEFT JOIN users u ON u.id = e2.user_id
            WHERE e2.lead_id = l.id AND e2.payload ->> 'fromStageId' = ${CC}
            ORDER BY e2.created_at DESC LIMIT 1) AS agente
    FROM lead_events e JOIN leads l ON l.id = e.lead_id
    LEFT JOIN stages s ON s.id = l.stage_id
    WHERE l.workspace_id = ${WS} AND e.type = 'status_change'
      AND e.payload ->> 'fromStageId' = ${CC} AND e.payload ->> 'reason' = 'auto_contacted'
      AND l.stage_id IS DISTINCT FROM ${CC}
    GROUP BY l.id, l.name, l.email, s.name ORDER BY cuando DESC LIMIT 25`;
  console.log("\nMuestra (los más recientes):");
  for (const r of sample)
    console.log(`  ${r.cuando.toISOString().slice(0,16)} ${r.name} | ${r.email} → quedó en ${r.stage} (agente: ${r.agente})`);

  // ¿Cuántos siguen fuera de CC pese a que la ÚLTIMA nota dice profile created?
  const stale = await sql`
    SELECT count(*)::int AS n FROM leads l
    WHERE l.workspace_id = ${WS} AND l.stage_id IS DISTINCT FROM ${CC}
      AND EXISTS (SELECT 1 FROM lead_events e WHERE e.lead_id = l.id
                  AND e.payload::text ~* '(profile created|contractor compliance|completing a1s|next steps explained)')`;
  console.log(`\nTOTAL de leads fuera de CC con alguna señal de CC en su historial: ${stale[0].n}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
