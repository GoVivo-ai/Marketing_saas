/** One-off: adds the 'developer' value to the user_role enum (additive, idempotent). */
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db";

if (!process.env.DATABASE_URL) {
  process.loadEnvFile(".env.local");
}

async function main() {
  await db().execute(sql`ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'developer'`);
  const rows = await db().execute(
    sql`SELECT unnest(enum_range(NULL::"user_role"))::text AS v`,
  );
  console.log("user_role values:", rows.map((r: Record<string, unknown>) => r.v).join(", "));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
