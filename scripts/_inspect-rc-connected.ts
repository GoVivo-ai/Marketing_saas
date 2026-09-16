process.loadEnvFile(".env.local");
import postgres from "postgres";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  console.log(await sql`SELECT name, email, role FROM users WHERE rc_access_token_enc IS NOT NULL`);
  console.log((await sql`SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name LIKE 'rc%'`).map((r) => r.column_name));
  await sql.end();
}
main();
