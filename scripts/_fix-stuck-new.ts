/**
 * Mueve en masivo los leads estancados en "New" que fueron contactados antes
 * del deploy del auto-avance (2026-08-06) y por eso nunca cambiaron de etapa.
 * Aplica la misma regla del auto-avance según su ÚLTIMO outcome:
 * answered/replied → Contacted; todo lo demás → Attempted to Contact.
 * Dry-run por defecto; `--apply` escribe.
 */
process.loadEnvFile(".env.local");
import postgres from "postgres";
const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63";
const NEW = "1f711b83-a724-4d47-ab36-866289929ca2";
const ATTEMPTED = "52897661-1bb2-41bd-ba54-a1d813173f3a";
const CONTACTED = "955e6ae0-a264-4c49-8fc0-3e55270244da";
const APPLY = process.argv.includes("--apply");

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const rows = await sql`
    SELECT DISTINCT ON (l.id) l.id, l.name, e.type, e.payload->>'outcome' AS outcome, e.created_at
    FROM leads l
    JOIN lead_events e ON e.lead_id = l.id AND e.type IN ('call','sms','whatsapp','email')
    WHERE l.workspace_id = ${WS} AND l.stage_id = ${NEW} AND l.disqual_l1 IS NULL
      AND e.created_at < now() - interval '15 days'
    ORDER BY l.id, e.created_at DESC`;
  // El último toque decide (puede ser <15d si hubo otro después; DISTINCT ON ya tomó el último global
  // porque el JOIN no filtra el orden — corrijo: filtro solo exige ALGÚN toque viejo; el outcome usado es el último).
  const last = await sql`
    SELECT DISTINCT ON (l.id) l.id, l.name, e.payload->>'outcome' AS outcome
    FROM leads l JOIN lead_events e ON e.lead_id = l.id AND e.type IN ('call','sms','whatsapp','email')
    WHERE l.workspace_id = ${WS} AND l.stage_id = ${NEW} AND l.disqual_l1 IS NULL
      AND EXISTS (SELECT 1 FROM lead_events e2 WHERE e2.lead_id = l.id
                  AND e2.type IN ('call','sms','whatsapp','email') AND e2.created_at < now() - interval '15 days')
    ORDER BY l.id, e.created_at DESC`;
  const toContacted = last.filter((r) => r.outcome === "answered" || r.outcome === "replied");
  const toAttempted = last.filter((r) => !toContacted.includes(r));
  console.log(`${APPLY ? "APLICANDO" : "DRY-RUN"} — estancados en New con contacto >15d: ${last.length}`);
  console.log(`  → Contacted (answered/replied): ${toContacted.length}`);
  console.log(`  → Attempted to Contact (resto): ${toAttempted.length}`);
  for (const r of toContacted) console.log(`    C ${r.name} (${r.outcome})`);
  if (!APPLY) { console.log("\n(sin cambios — vuelve a correr con --apply)"); await sql.end(); return; }

  for (const [ids, target] of [
    [toContacted.map((r) => r.id), CONTACTED],
    [toAttempted.map((r) => r.id), ATTEMPTED],
  ] as const) {
    if (!ids.length) continue;
    await sql`UPDATE leads SET stage_id = ${target}, status = 'contacted', updated_at = now()
              WHERE id = ANY(${ids})`;
    for (const id of ids)
      await sql`INSERT INTO lead_events (id, lead_id, user_id, type, payload)
                VALUES (gen_random_uuid()::text, ${id}, NULL, 'status_change',
                        ${sql.json({ fromStageId: NEW, toStageId: target, reason: "stuck_new_backfill" })})`;
  }
  console.log(`\nListo: ${last.length} leads movidos.`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
