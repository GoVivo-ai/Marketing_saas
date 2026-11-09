/**
 * Gives every lead already sitting in Contractor Compliance a fixed owner —
 * the agent who moved it into CC; failing that, the last agent who touched it
 * before it entered CC; failing that, the first agent who ever touched it.
 * Leads that already have an owner are left alone. Idempotent.
 * Run: npx tsx scripts/backfill-cc-owners.ts [--apply]
 */
process.loadEnvFile(".env.local");

import postgres from "postgres";

async function main() {
  const apply = process.argv.includes("--apply");
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const plan = await sql<{ slug: string; id: string; owner: string; how: string }[]>`
    with cc_stage as (
      select id, workspace_id from stages where workable = false and kind <> 'lost'
    ),
    cc as (
      select l.id, l.workspace_id, w.slug, cs.id as cc_stage_id
      from leads l
      join cc_stage cs on cs.id = l.stage_id
      join workspaces w on w.id = l.workspace_id
      where l.assigned_to_id is null
    ),
    mover as (
      select distinct on (e.lead_id) e.lead_id, e.user_id, e.created_at
      from lead_events e join cc on cc.id = e.lead_id
      where e.type = 'status_change' and e.user_id is not null
        and (e.payload->>'reason' = 'cc_activated' or e.payload->>'toStageId' = cc.cc_stage_id)
      order by e.lead_id, e.created_at desc
    ),
    entered as (
      select cc.id as lead_id,
        coalesce((select max(e.created_at) from lead_events e
          where e.lead_id = cc.id and e.type = 'status_change'
            and e.payload->>'toStageId' = cc.cc_stage_id), now()) as at
      from cc
    ),
    before_cc as (
      select distinct on (e.lead_id) e.lead_id, e.user_id
      from lead_events e join entered en on en.lead_id = e.lead_id
      where e.user_id is not null and e.created_at <= en.at
      order by e.lead_id, e.created_at desc
    ),
    first_touch as (
      select distinct on (e.lead_id) e.lead_id, e.user_id
      from lead_events e join cc on cc.id = e.lead_id
      where e.user_id is not null
      order by e.lead_id, e.created_at asc
    )
    select cc.slug, cc.id,
      coalesce(m.user_id, b.user_id, f.user_id) as owner,
      case when m.user_id is not null then 'mover'
           when b.user_id is not null then 'last_before_cc'
           when f.user_id is not null then 'first_touch' end as how
    from cc
    left join mover m on m.lead_id = cc.id
    left join before_cc b on b.lead_id = cc.id
    left join first_touch f on f.lead_id = cc.id`;

  const summary: Record<string, Record<string, number>> = {};
  for (const r of plan) {
    summary[r.slug] ??= {};
    const k = r.owner ? r.how : "no_agent_ever";
    summary[r.slug][k] = (summary[r.slug][k] ?? 0) + 1;
  }
  console.table(summary);

  const assignable = plan.filter((r) => r.owner);
  if (!apply) {
    console.log(`Dry run — ${assignable.length} leads would get an owner. Re-run with --apply.`);
  } else {
    let n = 0;
    for (const r of assignable) {
      const res = await sql`
        update leads set assigned_to_id = ${r.owner}
        where id = ${r.id} and assigned_to_id is null`;
      n += res.count;
    }
    console.log(`Assigned ${n} leads.`);
  }
  await sql.end();
}
main();
