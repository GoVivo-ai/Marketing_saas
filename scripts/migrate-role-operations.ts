/** Adds the 'operations' value to user_role (dispatch-only users). Idempotent. */
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db";

if (!process.env.DATABASE_URL) {
  process.loadEnvFile(".env.local");
}

async function main() {
  await db().execute(sql`ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'operations'`);
  const rows = await db().execute(
    sql`SELECT unnest(enum_range(NULL::"user_role"))::text AS v`,
  );
  console.log("user_role values:", rows);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
