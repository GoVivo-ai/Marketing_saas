process.loadEnvFile(".env.local");
import postgres from "postgres";
const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63";
const NEW = "1f711b83-a724-4d47-ab36-866289929ca2";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const byMonth = await sql`
    WITH last AS (
      SELECT l.id, max(e.created_at) AS last_at
      FROM leads l JOIN lead_events e ON e.lead_id = l.id AND e.type IN ('call','sms','whatsapp','email')
      WHERE l.workspace_id=${WS} AND l.stage_id=${NEW} GROUP BY l.id)
    SELECT to_char(last_at,'YYYY-MM') AS m, count(*)::int n FROM last GROUP BY 1 ORDER BY 1`;
  console.log("Último contacto de los estancados, por mes:", byMonth.map(r=>`${r.m}:${r.n}`).join("  "));

  const [withMove] = await sql`
    SELECT count(*)::int n FROM leads l WHERE l.workspace_id=${WS} AND l.stage_id=${NEW}
    AND EXISTS (SELECT 1 FROM lead_events e WHERE e.lead_id=l.id AND e.type='status_change')`;
  console.log("Estancados que ALGUNA VEZ tuvieron status_change:", withMove.n);

  const [after] = await sql`
    SELECT count(DISTINCT l.id)::int n FROM leads l
    JOIN lead_events e ON e.lead_id=l.id AND e.type IN ('call','sms','whatsapp','email')
    WHERE l.workspace_id=${WS} AND l.stage_id=${NEW} AND e.created_at > '2026-08-08'`;
  console.log("Estancados con contacto POSTERIOR al 2026-08-08 (auto-avance ya vivo):", after.n);

  const outcomes = await sql`
    SELECT e.type, coalesce(e.payload->>'outcome','(sin outcome)') AS outcome,
           coalesce(e.payload->>'manual','-') AS manual, count(DISTINCT e.lead_id)::int n
    FROM leads l JOIN lead_events e ON e.lead_id=l.id AND e.type IN ('call','sms','whatsapp','email')
    WHERE l.workspace_id=${WS} AND l.stage_id=${NEW}
    GROUP BY 1,2,3 ORDER BY n DESC`;
  console.log("Outcomes registrados en los estancados:");
  for (const r of outcomes) console.log(`  ${r.type}/${r.outcome} manual=${r.manual}: ${r.n}`);
  await sql.end();
}
main().catch((e)=>{console.error(e);process.exit(1);});
