/** Diagnose why the pipeline city filter shows 0 CC leads for Las Vegas / Douglas County. */
process.loadEnvFile(".env.local");
import postgres from "postgres";

const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

  const stages = await sql`
    SELECT id, name, kind, workable, position FROM stages
    WHERE workspace_id = ${WS} ORDER BY position`;
  console.log("STAGES:", stages.map((s) => `${s.position}:${s.name} kind=${s.kind} workable=${s.workable}`));

  const cc = stages.find((s) => !s.workable && s.kind !== "lost");
  console.log("CC stage:", cc?.name, cc?.id);

  const byStage = await sql`
    SELECT s.name, count(*)::int AS n FROM leads l
    LEFT JOIN stages s ON s.id = l.stage_id
    WHERE l.workspace_id = ${WS}
    GROUP BY s.name ORDER BY n DESC`;
  console.log("LEADS BY STAGE (null = sin stage):", byStage);

  if (cc) {
    const geo = await sql`
      SELECT
        coalesce(a.city_name, l.form_data ->> 'advertisement_area') AS pipeline_city,
        l.geo_city,
        count(*)::int AS n
      FROM leads l
      LEFT JOIN adsets a ON a.id = l.adset_id
      WHERE l.workspace_id = ${WS} AND l.stage_id = ${cc.id}
      GROUP BY 1, 2 ORDER BY n DESC LIMIT 40`;
    console.log("CC LEADS — pipeline_city (filtro del pipeline) vs geo_city (real):");
    for (const r of geo) console.log(`  pipeline_city=${JSON.stringify(r.pipeline_city)} geo_city=${JSON.stringify(r.geo_city)} n=${r.n}`);

    const vegas = await sql`
      SELECT count(*)::int AS n FROM leads l
      WHERE l.workspace_id = ${WS} AND l.stage_id = ${cc.id}
        AND (l.geo_city ILIKE '%vegas%' OR l.form_data ->> 'advertisement_area' ILIKE '%vegas%')`;
    const douglas = await sql`
      SELECT count(*)::int AS n FROM leads l
      WHERE l.workspace_id = ${WS} AND l.stage_id = ${cc.id}
        AND (l.geo_city ILIKE '%douglas%' OR l.form_data ->> 'advertisement_area' ILIKE '%douglas%')`;
    console.log("CC + Las Vegas (por geo_city o area):", vegas[0].n);
    console.log("CC + Douglas (por geo_city o area):", douglas[0].n);
  }

  const nullStage = await sql`
    SELECT platform, count(*)::int AS n FROM leads
    WHERE workspace_id = ${WS} AND stage_id IS NULL GROUP BY platform`;
  console.log("LEADS SIN STAGE por plataforma:", nullStage);

  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
