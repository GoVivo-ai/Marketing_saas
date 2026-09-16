/**
 * One-off (2026-08-05): align AlexYah's pipeline with the agreed 4-stage funnel
 * and recover CC activations the team recorded as free-text notes.
 *
 * 1. "In Contractor Compliance" becomes an intermediate stage (kind open, stays
 *    out of the queue via workable=false) and a terminal "Hired" stage is added.
 * 2. Leads whose notes/call logs say the CC profile was created ("CC PROFILE
 *    CREATED", "Moved to CC", …) are moved to the CC stage — unless they were
 *    disqualified AFTER that note, in which case Lost wins.
 */
process.loadEnvFile(".env.local");
import postgres from "postgres";

const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63"; // AlexYah
const CC = "1a88f4cc-40c8-4deb-9cd2-07e67ed068e3"; // In Contractor Compliance
const CC_NOTE = "(cc profile|create.? cc|moved? to cc|in cc|compliance)";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

  await sql.begin(async (tx) => {
    // ── 1. Stage restructure ────────────────────────────────────────────
    const hasHired = await tx`
      SELECT 1 FROM stages WHERE workspace_id = ${WS} AND kind = 'won' AND id::text <> ${CC}`;
    if (hasHired.length === 0) {
      await tx`UPDATE stages SET kind = 'open' WHERE id::text = ${CC}`;
      await tx`UPDATE stages SET position = position + 1
               WHERE workspace_id = ${WS} AND kind = 'lost'`;
      const [hired] = await tx`
        INSERT INTO stages (id, workspace_id, name, color, kind, workable, position)
        VALUES (gen_random_uuid(), ${WS}, 'Hired', '#047a52', 'won', false, 5) RETURNING id`;
      console.log("Etapas: In CC → open (intermedia); Hired creada:", hired.id);
    } else {
      console.log("Etapas ya reestructuradas — no se tocan.");
    }

    // Existing CC residents: re-derive the legacy status (CC is no longer won).
    const restatused = await tx`
      UPDATE leads SET status = 'contacted'
      WHERE workspace_id = ${WS} AND stage_id::text = ${CC} AND status = 'won'`;
    console.log("Leads en CC con status 'won' → 'contacted':", restatused.count);

    // ── 2. Backfill from notes ──────────────────────────────────────────
    // Latest CC-note timestamp per lead not already in CC.
    const candidates = await tx`
      SELECT l.id, l.name, l.stage_id, s.kind AS stage_kind, s.name AS stage_name,
             l.disqual_l1, max(e.created_at) AS cc_noted_at
      FROM leads l
      JOIN lead_events e ON e.lead_id = l.id
      LEFT JOIN stages s ON s.id = l.stage_id
      WHERE l.workspace_id = ${WS} AND l.stage_id::text <> ${CC}
        AND (e.payload ->> 'note' ~* ${CC_NOTE} OR e.payload ->> 'text' ~* ${CC_NOTE})
      GROUP BY l.id, l.name, l.stage_id, s.kind, s.name, l.disqual_l1`;

    let moved = 0;
    const skipped: string[] = [];
    for (const c of candidates) {
      if (c.stage_kind === "lost") {
        // Was it disqualified AFTER the CC note? Then the disqualification wins.
        const [dq] = await tx`
          SELECT max(created_at) AS at FROM lead_events
          WHERE lead_id = ${c.id} AND type IN ('disqualified', 'status_change')
            AND (payload ->> 'reason' = 'disqualified' OR type = 'disqualified')`;
        if (dq?.at && dq.at > c.cc_noted_at) {
          skipped.push(`${c.name} (descalificado después de la nota CC)`);
          continue;
        }
      }
      await tx`
        UPDATE leads SET stage_id = ${CC}::uuid, status = 'contacted',
          disqual_l1 = NULL, disqual_l2 = NULL, disqual_l3 = NULL, updated_at = now()
        WHERE id = ${c.id}`;
      await tx`
        INSERT INTO lead_events (id, lead_id, type, payload)
        VALUES (gen_random_uuid(), ${c.id}, 'status_change',
          ${tx.json({ fromStageId: c.stage_id, toStageId: CC, reason: "cc_note_backfill" })})`;
      moved++;
    }
    console.log(`Backfill: ${moved} leads movidos a In Contractor Compliance.`);
    if (skipped.length) {
      console.log("Omitidos (Lost más reciente que la nota CC):");
      for (const s of skipped) console.log("  -", s);
    }
  });

  // Verify
  const check = await sql`
    SELECT s.position, s.name, s.kind, s.workable, count(l.id)::int AS leads
    FROM stages s LEFT JOIN leads l ON l.stage_id = s.id
    WHERE s.workspace_id = ${WS}
    GROUP BY s.id ORDER BY s.position`;
  console.log("\nEstado final de etapas:");
  for (const r of check)
    console.log(`  ${r.position}: ${r.name} (${r.kind}${r.workable ? "" : ", no-queue"}) — ${r.leads} leads`);

  const vegas = await sql`
    SELECT count(*)::int AS n FROM leads l
    LEFT JOIN adsets a ON a.id = l.adset_id
    WHERE l.workspace_id = ${WS} AND l.stage_id::text = ${CC}
      AND (l.geo_city ILIKE '%vegas%' OR a.city_name ILIKE '%vegas%')`;
  console.log("Leads de Las Vegas ahora en CC:", vegas[0].n);

  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
