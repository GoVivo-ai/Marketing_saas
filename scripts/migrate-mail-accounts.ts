/**
 * Creates mail_accounts — the Gmail/Outlook account each user connects to
 * email leads from the platform. Idempotent.
 * Run: npx tsx scripts/migrate-mail-accounts.ts
 */
process.loadEnvFile(".env.local");

import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  await sql`
    CREATE TABLE IF NOT EXISTS mail_accounts (
      id text PRIMARY KEY,
      user_id text NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      provider text NOT NULL,
      address text NOT NULL,
      display_name text,
      access_token_enc text NOT NULL,
      refresh_token_enc text NOT NULL,
      token_expires_at timestamp NOT NULL,
      connected_at timestamp NOT NULL DEFAULT now(),
      last_error text
    )`;
  console.log("mail_accounts ready");
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
