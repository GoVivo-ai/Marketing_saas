/** Adds leads.cc_status — the Contractor Compliance sub-pipeline state. */
process.loadEnvFile(".env.local");
import postgres from "postgres";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS cc_status text`;
  console.log("leads.cc_status listo");
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
