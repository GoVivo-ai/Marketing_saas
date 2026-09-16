process.loadEnvFile(".env.local");
import postgres from "postgres";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

  const ws = await sql`SELECT id, name FROM workspaces ORDER BY created_at`;
  console.log("WORKSPACES:", ws.map((w) => `${w.name} ${w.id}`));

  // Vegas/Douglas leads per workspace
  const vegas = await sql`
    SELECT w.name AS ws, s.name AS stage, count(*)::int AS n
    FROM leads l JOIN workspaces w ON w.id = l.workspace_id
    LEFT JOIN stages s ON s.id = l.stage_id
    LEFT JOIN adsets a ON a.id = l.adset_id
    WHERE l.geo_city ILIKE '%vegas%' OR l.form_data ->> 'advertisement_area' ILIKE '%vegas%'
       OR a.city_name ILIKE '%vegas%'
    GROUP BY 1, 2 ORDER BY 1, n DESC`;
  console.log("\nLEADS DE VEGAS por workspace/etapa (incl. por adset):");
  for (const r of vegas) console.log(`  ${r.ws} | ${r.stage} | ${r.n}`);

  // What event types do humans generate on vegas leads (any workspace)?
  const ev = await sql`
    SELECT e.type, coalesce(u.name, u.email, 'sistema') AS who, count(*)::int AS n
    FROM lead_events e
    JOIN leads l ON l.id = e.lead_id
    LEFT JOIN adsets a ON a.id = l.adset_id
    LEFT JOIN users u ON u.id = e.user_id
    WHERE (l.geo_city ILIKE '%vegas%' OR a.city_name ILIKE '%vegas%')
    GROUP BY 1, 2 ORDER BY n DESC LIMIT 25`;
  console.log("\nEVENTOS en leads de Vegas por tipo/usuario:");
  for (const r of ev) console.log(`  ${r.type} | ${r.who} | ${r.n}`);

  // Recent human activity across the workspace: who does what
  const act = await sql`
    SELECT coalesce(u.name, u.email) AS who, e.type, count(*)::int AS n
    FROM lead_events e JOIN users u ON u.id = e.user_id
    WHERE e.created_at > now() - interval '30 days'
    GROUP BY 1, 2 ORDER BY n DESC LIMIT 25`;
  console.log("\nACTIVIDAD HUMANA últimos 30 días (todo el sistema):");
  for (const r of act) console.log(`  ${r.who} | ${r.type} | ${r.n}`);

  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
