/**
 * Adds an "Outside Current Service Area" lost stage after the workspace's
 * last stage, for leads disqualified as Location / Coverage, and moves the
 * leads already disqualified for that reason out of the generic lost column
 * into it. Idempotent. Run: npx tsx scripts/migrate-out-of-area-stage.ts [--apply]
 */
process.loadEnvFile(".env.local");

import postgres from "postgres";

const NAME = "Outside Current Service Area";

async function main() {
  const apply = process.argv.includes("--apply");
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

  const targets = await sql<{ workspace_id: string; slug: string; max_pos: number }[]>`
    select s.workspace_id, w.slug, max(s.position)::int max_pos
    from stages s join workspaces w on w.id = s.workspace_id
    where exists (select 1 from stages l where l.workspace_id = s.workspace_id and l.kind = 'lost')
      and not exists (select 1 from stages o where o.workspace_id = s.workspace_id and o.kind = 'lost' and o.name ilike '%area%')
    group by s.workspace_id, w.slug`;
  console.log("workspaces needing the stage:", targets.map((t) => t.slug).join(", ") || "none");

  const plan = await sql<{ slug: string; n: number }[]>`
    select w.slug, count(*)::int n
    from leads l join workspaces w on w.id = l.workspace_id join stages s on s.id = l.stage_id
    where s.kind = 'lost' and s.name not ilike '%area%' and l.disqual_l2 ilike '%location%'
    group by w.slug`;
  console.table(plan);
  if (!apply) { console.log("Dry run. Re-run with --apply."); await sql.end(); return; }

  for (const t of targets) {
    await sql`insert into stages (id, workspace_id, name, color, kind, workable, parked, position)
      values (gen_random_uuid()::text, ${t.workspace_id}, ${NAME}, '#64748b', 'lost', false, false, ${t.max_pos + 1})`;
    console.log(`${t.slug}: created "${NAME}"`);
  }
  const moved = await sql`
    with target as (select workspace_id, id from stages where kind = 'lost' and name ilike '%area%'),
    mv as (
      update leads l set stage_id = t.id, updated_at = now()
      from stages s, target t
      where s.id = l.stage_id and s.kind = 'lost' and s.name not ilike '%area%'
        and t.workspace_id = l.workspace_id and l.disqual_l2 ilike '%location%'
      returning l.id, s.id as from_id, t.id as to_id)
    insert into lead_events (id, lead_id, user_id, type, payload, created_at)
    select gen_random_uuid()::text, id, null, 'status_change',
      jsonb_build_object('fromStageId', from_id, 'toStageId', to_id, 'reason', 'out_of_area_backfill'), now()
    from mv`;
  console.log(`moved ${moved.count} leads`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
