/**
 * Devuelve a "In Contractor Compliance" los leads que el auto-avance sacó de
 * esa etapa (llamada de seguimiento registrada después de la activación).
 * No toca los que salieron por descalificación, contratación o movimiento
 * manual. Dry-run por defecto; `--apply` escribe.
 */
process.loadEnvFile(".env.local");
import postgres from "postgres";
const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63";
const CC = "1a88f4cc-40c8-4deb-9cd2-07e67ed068e3";
const APPLY = process.argv.includes("--apply");

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  // Última salida de CC por lead; solo cuenta si fue el auto-avance y si el
  // lead no fue descalificado ni contratado después.
  const rows = await sql`
    WITH last_exit AS (
      SELECT DISTINCT ON (e.lead_id) e.lead_id, e.created_at, e.payload ->> 'reason' AS reason
      FROM lead_events e JOIN leads l ON l.id = e.lead_id
      WHERE l.workspace_id = ${WS} AND e.type = 'status_change'
        AND e.payload ->> 'fromStageId' = ${CC}
      ORDER BY e.lead_id, e.created_at DESC
    )
    SELECT l.id, l.name, l.email, s.name AS stage, s.kind, x.reason, x.created_at
    FROM last_exit x
    JOIN leads l ON l.id = x.lead_id
    LEFT JOIN stages s ON s.id = l.stage_id
    WHERE x.reason = 'auto_contacted' AND l.stage_id IS DISTINCT FROM ${CC}
      AND s.kind = 'open'
    ORDER BY x.created_at DESC`;

  console.log(`${APPLY ? "APLICANDO" : "DRY-RUN"} — leads a devolver a CC: ${rows.length}`);
  for (const r of rows)
    console.log(`  ${r.created_at.toISOString().slice(0,16)} ${r.name} | ${r.email} : ${r.stage} → In Contractor Compliance`);
  if (!APPLY) { console.log("\n(sin cambios — vuelve a correr con --apply)"); await sql.end(); return; }

  for (const r of rows) {
    await sql`UPDATE leads SET stage_id = ${CC}, status = 'contacted', updated_at = now() WHERE id = ${r.id}`;
    await sql`
      INSERT INTO lead_events (id, lead_id, user_id, type, payload)
      VALUES (gen_random_uuid()::text, ${r.id}, NULL, 'status_change',
              ${sql.json({ fromStageId: null, toStageId: CC, reason: "cc_demotion_repair" })})`;
  }
  console.log(`\nListo: ${rows.length} leads devueltos a In Contractor Compliance.`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
