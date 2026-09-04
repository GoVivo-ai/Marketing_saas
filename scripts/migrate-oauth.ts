/**
 * Creates the OAuth 2.1 authorization-server tables used by the MCP
 * endpoint (oauth_clients, oauth_codes, oauth_tokens). Idempotent.
 */
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db";

if (!process.env.DATABASE_URL) {
  process.loadEnvFile(".env.local");
}

async function main() {
  await db().execute(sql`
    CREATE TABLE IF NOT EXISTS "oauth_clients" (
      "id" text PRIMARY KEY,
      "name" text NOT NULL,
      "secret_hash" text,
      "redirect_uris" jsonb NOT NULL,
      "token_endpoint_auth_method" text NOT NULL DEFAULT 'none',
      "created_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db().execute(sql`
    CREATE TABLE IF NOT EXISTS "oauth_codes" (
      "id" text PRIMARY KEY,
      "code_hash" text NOT NULL UNIQUE,
      "client_id" text NOT NULL REFERENCES "oauth_clients"("id") ON DELETE CASCADE,
      "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "redirect_uri" text NOT NULL,
      "code_challenge" text NOT NULL,
      "scope" text NOT NULL DEFAULT 'read',
      "resource" text,
      "expires_at" timestamp NOT NULL,
      "used_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db().execute(sql`
    CREATE TABLE IF NOT EXISTS "oauth_tokens" (
      "id" text PRIMARY KEY,
      "client_id" text NOT NULL REFERENCES "oauth_clients"("id") ON DELETE CASCADE,
      "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "access_hash" text NOT NULL UNIQUE,
      "refresh_hash" text NOT NULL UNIQUE,
      "scope" text NOT NULL DEFAULT 'read',
      "access_expires_at" timestamp NOT NULL,
      "refresh_expires_at" timestamp NOT NULL,
      "revoked_at" timestamp,
      "last_used_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db().execute(
    sql`CREATE INDEX IF NOT EXISTS "oauth_token_user_idx" ON "oauth_tokens" ("user_id")`,
  );
  console.log("oauth tables ready");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
