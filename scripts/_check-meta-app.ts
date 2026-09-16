process.loadEnvFile(".env.local");
import postgres from "postgres";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const rows = await sql`SELECT name, meta_app_id, (meta_app_secret_enc IS NOT NULL) AS has_secret FROM workspaces WHERE is_active`;
  for (const r of rows) console.log(`${r.name}: app_id=${r.meta_app_id ?? "—"} secret=${r.has_secret ? "sí" : "no"}`);
  await sql.end();
}
main().catch((e)=>{console.error(e);process.exit(1);});
