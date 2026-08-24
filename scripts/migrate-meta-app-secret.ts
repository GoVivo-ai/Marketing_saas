/** Adds per-workspace Meta app credentials for the leadgen webhook. */
process.loadEnvFile(".env.local");
import postgres from "postgres";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  await sql`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS meta_app_id text`;
  await sql`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS meta_app_secret_enc text`;
  console.log("workspaces.meta_app_id / meta_app_secret_enc listos");
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
