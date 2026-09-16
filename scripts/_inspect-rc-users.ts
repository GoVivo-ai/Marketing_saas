process.loadEnvFile(".env.local");
import postgres from "postgres";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  console.log(await sql`SELECT name, rc_access_token_enc IS NOT NULL AS connected, rc_token_expires_at FROM users WHERE name IN ('Juliana Gutierrez','María Alejandra Pantoja Cuellar','Juan Pablo Rivas','Emily Arévalo')`.catch(async () => sql`SELECT name, rc_access_token_enc IS NOT NULL AS connected FROM users WHERE name ILIKE 'Juliana%' OR name ILIKE 'María%' OR name ILIKE 'Juan Pablo%'`));
  console.log(await sql`SELECT u.name, left(c.external_id, 12) sample, count(*)::int FROM call_logs c JOIN users u ON u.id=c.user_id WHERE c.start_time >= '2026-09-01' GROUP BY 1,2 ORDER BY 1, 3 DESC LIMIT 12`);
  await sql.end();
}
main();
