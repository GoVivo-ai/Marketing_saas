process.loadEnvFile(".env.local");
import postgres from "postgres";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const stages = await sql`
    SELECT workspace_id, position, name, kind, workable FROM stages ORDER BY workspace_id, position`;
  for (const s of stages) console.log(`${s.workspace_id.slice(0,8)} ${s.position}: ${s.name} kind=${s.kind} workable=${s.workable}`);
  await sql.end();
}
main();
