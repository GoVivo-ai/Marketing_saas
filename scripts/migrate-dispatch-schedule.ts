/** Creates dispatch_schedule_trips (EverDriven CSV ingest w/ history). Idempotent. */
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db";

if (!process.env.DATABASE_URL) {
  process.loadEnvFile(".env.local");
}

async function main() {
  await db().execute(sql`
    CREATE TABLE IF NOT EXISTS "dispatch_schedule_trips" (
      "id" text PRIMARY KEY,
      "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
      "trip_date" date NOT NULL,
      "start" text NOT NULL,
      "end" text,
      "driver_name" text NOT NULL,
      "norm_name" text NOT NULL,
      "driver_id" text REFERENCES "dispatch_drivers"("id") ON DELETE SET NULL,
      "status" text,
      "run" text,
      "uploaded_at" timestamp NOT NULL DEFAULT now(),
      "created_at" timestamp NOT NULL DEFAULT now()
    )`);
  await db().execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "dispatch_trip_unique" ON "dispatch_schedule_trips" ("workspace_id", "trip_date", "run", "norm_name", "start")`,
  );
  await db().execute(
    sql`CREATE INDEX IF NOT EXISTS "dispatch_trip_date_idx" ON "dispatch_schedule_trips" ("workspace_id", "trip_date")`,
  );
  await db().execute(
    sql`CREATE INDEX IF NOT EXISTS "dispatch_trip_driver_idx" ON "dispatch_schedule_trips" ("driver_id")`,
  );
  console.log("dispatch_schedule_trips created");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
