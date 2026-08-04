/**
 * Creates the dispatch module tables (drivers / covers / interactions).
 * Idempotent — CREATE TABLE IF NOT EXISTS mirrors src/lib/db/schema.ts.
 */
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db";

if (!process.env.DATABASE_URL) {
  process.loadEnvFile(".env.local");
}

async function main() {
  await db().execute(sql`
    CREATE TABLE IF NOT EXISTS "dispatch_drivers" (
      "id" text PRIMARY KEY,
      "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
      "mdd" text,
      "name" text NOT NULL,
      "norm_name" text NOT NULL,
      "state" text,
      "area" text,
      "address" text,
      "status" text NOT NULL DEFAULT 'active',
      "has_routes" boolean NOT NULL DEFAULT true,
      "phone" text,
      "email" text,
      "emergency_name" text,
      "emergency_phone" text,
      "emergency_relation" text,
      "camera" boolean NOT NULL DEFAULT false,
      "car_seats" integer NOT NULL DEFAULT 0,
      "booster_seats" integer NOT NULL DEFAULT 0,
      "notes" text,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )`);
  await db().execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "dispatch_driver_mdd_unique" ON "dispatch_drivers" ("workspace_id", "mdd")`,
  );
  await db().execute(
    sql`CREATE INDEX IF NOT EXISTS "dispatch_driver_workspace_idx" ON "dispatch_drivers" ("workspace_id")`,
  );
  await db().execute(
    sql`CREATE INDEX IF NOT EXISTS "dispatch_driver_norm_name_idx" ON "dispatch_drivers" ("workspace_id", "norm_name")`,
  );

  await db().execute(sql`
    CREATE TABLE IF NOT EXISTS "dispatch_covers" (
      "id" text PRIMARY KEY,
      "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
      "date" timestamp,
      "rescue_date" timestamp,
      "company" text,
      "area" text,
      "reason" text,
      "driver_id" text REFERENCES "dispatch_drivers"("id") ON DELETE SET NULL,
      "driver_name" text,
      "rescue_driver_id" text REFERENCES "dispatch_drivers"("id") ON DELETE SET NULL,
      "rescue_name" text,
      "payment" text,
      "comments" text,
      "created_at" timestamp NOT NULL DEFAULT now()
    )`);
  await db().execute(
    sql`CREATE INDEX IF NOT EXISTS "dispatch_cover_workspace_idx" ON "dispatch_covers" ("workspace_id", "date")`,
  );
  await db().execute(
    sql`CREATE INDEX IF NOT EXISTS "dispatch_cover_driver_idx" ON "dispatch_covers" ("driver_id")`,
  );
  await db().execute(
    sql`CREATE INDEX IF NOT EXISTS "dispatch_cover_rescue_idx" ON "dispatch_covers" ("rescue_driver_id")`,
  );

  await db().execute(sql`
    CREATE TABLE IF NOT EXISTS "dispatch_interactions" (
      "id" text PRIMARY KEY,
      "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
      "sp_item_id" text,
      "driver_id" text REFERENCES "dispatch_drivers"("id") ON DELETE SET NULL,
      "driver_name" text,
      "priority" text,
      "status" text,
      "description" text,
      "classification" text,
      "category" text,
      "sub_categories" jsonb,
      "assigned_to" text,
      "created_by" text,
      "modified_by" text,
      "sp_created_at" timestamp,
      "sp_modified_at" timestamp,
      "resolved_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now()
    )`);
  await db().execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "dispatch_interaction_sp_unique" ON "dispatch_interactions" ("workspace_id", "sp_item_id")`,
  );
  await db().execute(
    sql`CREATE INDEX IF NOT EXISTS "dispatch_interaction_workspace_idx" ON "dispatch_interactions" ("workspace_id", "sp_created_at")`,
  );
  await db().execute(
    sql`CREATE INDEX IF NOT EXISTS "dispatch_interaction_driver_idx" ON "dispatch_interactions" ("driver_id")`,
  );

  console.log("dispatch tables created");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
