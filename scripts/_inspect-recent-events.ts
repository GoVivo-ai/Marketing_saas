process.loadEnvFile(".env.local");
import postgres from "postgres";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const rows = await sql`
    SELECT e.created_at, e.type, e.payload, l.name AS lead, s.name AS stage
    FROM lead_events e
    JOIN leads l ON l.id = e.lead_id
    LEFT JOIN stages s ON s.id = l.stage_id
    WHERE e.created_at > now() - interval '2 hours'
    ORDER BY e.created_at DESC LIMIT 40`;
  for (const r of rows)
    console.log(r.created_at.toISOString(), `[${r.lead}]`, `stage=${r.stage}`, r.type, JSON.stringify(r.payload).slice(0, 140));
  await sql.end();
}
main();
