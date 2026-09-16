process.loadEnvFile(".env.local");
import postgres from "postgres";
const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const agents = await sql`
    SELECT DISTINCT u.id, u.name FROM lead_events e
    JOIN leads l ON l.id = e.lead_id JOIN users u ON u.id = e.user_id
    WHERE l.workspace_id = ${WS} ORDER BY u.name`;
  console.log("Agentes con gestión:", agents.map(a=>a.name).join(" · "));
  for (const a of agents.slice(0, 6)) {
    const [r] = await sql`
      SELECT count(*)::int n FROM leads l
      WHERE l.workspace_id = ${WS}
        AND EXISTS (SELECT 1 FROM lead_events e WHERE e.lead_id = l.id AND e.user_id = ${a.id})`;
    console.log(`  ${a.name}: ${r.n} leads gestionados`);
  }
  // Muestra del "último actor" (el circulito) para 5 tarjetas de CC
  const cards = await sql`
    SELECT l.name, l.cc_status,
      (SELECT u.name FROM lead_events e JOIN users u ON u.id = e.user_id
       WHERE e.lead_id = l.id ORDER BY e.created_at DESC LIMIT 1) AS agent
    FROM leads l WHERE l.workspace_id = ${WS}
      AND l.stage_id = '1a88f4cc-40c8-4deb-9cd2-07e67ed068e3'
    ORDER BY l.created_at DESC LIMIT 6`;
  console.log("Tarjetas CC (nombre | sub-estado | agente):");
  for (const c of cards) console.log(`  ${c.name} | ${c.cc_status} | ${c.agent}`);
  await sql.end();
}
main().catch((e)=>{console.error(e);process.exit(1);});
