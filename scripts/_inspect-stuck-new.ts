process.loadEnvFile(".env.local");
import postgres from "postgres";
const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63";
const NEW = "1f711b83-a724-4d47-ab36-866289929ca2";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const [tot] = await sql`SELECT count(*)::int n FROM leads WHERE workspace_id=${WS} AND stage_id=${NEW}`;
  const [touched] = await sql`
    SELECT count(*)::int n FROM leads l WHERE l.workspace_id=${WS} AND l.stage_id=${NEW}
      AND EXISTS (SELECT 1 FROM lead_events e WHERE e.lead_id=l.id AND e.type IN ('call','sms','whatsapp','email','note'))`;
  const [old] = await sql`
    SELECT count(*)::int n FROM leads l WHERE l.workspace_id=${WS} AND l.stage_id=${NEW}
      AND EXISTS (SELECT 1 FROM lead_events e WHERE e.lead_id=l.id
                  AND e.type IN ('call','sms','whatsapp','email') AND e.created_at < now() - interval '15 days')`;
  console.log(`En "New": ${tot.n} | con algún evento: ${touched.n} | con contacto real de hace >15 días: ${old.n}`);
  const who = await sql`
    SELECT coalesce(u.name,'system') AS quien, count(DISTINCT l.id)::int n
    FROM leads l JOIN lead_events e ON e.lead_id=l.id LEFT JOIN users u ON u.id=e.user_id
    WHERE l.workspace_id=${WS} AND l.stage_id=${NEW} AND e.type IN ('call','sms','whatsapp','email')
    GROUP BY 1 ORDER BY n DESC`;
  console.log("Quién los tocó:", who.map(r=>`${r.quien}:${r.n}`).join("  "));
  await sql.end();
}
main().catch((e)=>{console.error(e);process.exit(1);});
