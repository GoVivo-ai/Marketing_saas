/**
 * Adds stages.parked (a holding stage: leads wait there until their callback
 * date) and creates a "Future Follow-Up" stage right before Contractor
 * Compliance in every workspace that has a CC stage and no holding stage
 * yet. Idempotent. Run: npx tsx scripts/migrate-stage-parked.ts
 */
process.loadEnvFile(".env.local");

import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  await sql`ALTER TABLE stages ADD COLUMN IF NOT EXISTS parked boolean NOT NULL DEFAULT false`;

  const targets = await sql<{ workspace_id: string; slug: string; cc_position: number }[]>`
    select distinct on (s.workspace_id) s.workspace_id, w.slug, s.position as cc_position
    from stages s join workspaces w on w.id = s.workspace_id
    where s.kind = 'open' and s.workable = false
      and not exists (select 1 from stages p where p.workspace_id = s.workspace_id and p.parked)
    order by s.workspace_id, s.position`;
  for (const t of targets) {
    await sql.begin(async (tx) => {
      await tx`update stages set position = position + 1
        where workspace_id = ${t.workspace_id} and position >= ${t.cc_position}`;
      await tx`insert into stages (id, workspace_id, name, color, kind, workable, parked, position)
        values (gen_random_uuid()::text, ${t.workspace_id}, 'Future Follow-Up', '#f59e0b', 'open', true, true, ${t.cc_position})`;
    });
    console.log(`${t.slug}: created "Future Follow-Up" at position ${t.cc_position}`);
  }
  console.table(
    await sql`select w.slug, s.name, s.kind, s.workable, s.parked, s.position
      from stages s join workspaces w on w.id = s.workspace_id order by w.slug, s.position`,
  );
  await sql.end();
}
main();
