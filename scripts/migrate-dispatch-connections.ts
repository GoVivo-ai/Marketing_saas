/**
 * Creates dispatch_connections (per-workspace Microsoft Graph credentials)
 * and migrates Alexyah's current env-based connection into it. Idempotent.
 */
import { sql, eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { encryptSecret } from "../src/lib/crypto";

if (!process.env.DATABASE_URL) {
  process.loadEnvFile(".env.local");
}

const ALEXYAH_WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63";

async function main() {
  await db().execute(sql`
    CREATE TABLE IF NOT EXISTS "dispatch_connections" (
      "id" text PRIMARY KEY,
      "workspace_id" text NOT NULL UNIQUE REFERENCES "workspaces"("id") ON DELETE CASCADE,
      "tenant_id" text NOT NULL,
      "client_id" text NOT NULL,
      "client_secret_enc" text NOT NULL,
      "site_url" text NOT NULL,
      "list_name" text NOT NULL,
      "last_synced_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )`);

  const { MS_TENANT_ID, MS_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, SHAREPOINT_SITE_URL, SHAREPOINT_LIST_NAME } =
    process.env;
  if (MS_TENANT_ID && MS_CLIENT_ID && MS_GRAPH_CLIENT_SECRET && SHAREPOINT_SITE_URL) {
    const [existing] = await db()
      .select({ id: schema.dispatchConnections.id })
      .from(schema.dispatchConnections)
      .where(eq(schema.dispatchConnections.workspaceId, ALEXYAH_WS))
      .limit(1);
    if (!existing) {
      await db().insert(schema.dispatchConnections).values({
        workspaceId: ALEXYAH_WS,
        tenantId: MS_TENANT_ID,
        clientId: MS_CLIENT_ID,
        clientSecretEnc: encryptSecret(MS_GRAPH_CLIENT_SECRET),
        siteUrl: SHAREPOINT_SITE_URL,
        listName: SHAREPOINT_LIST_NAME ?? "Alexyah's Interactions",
      });
      console.log("Alexyah connection migrated from env to DB (secret encrypted)");
    } else {
      console.log("Alexyah connection already in DB — nothing to migrate");
    }
  } else {
    console.log("env credentials incomplete — table created, no migration");
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
