/**
 * Creates the `adsets` and `adset_metrics_daily` tables. Idempotent.
 * Run: npx tsx scripts/migrate-adsets.ts
 * (drizzle-kit push is broken in this repo, so we DDL directly.)
 */
process.loadEnvFile(".env.local");

import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

  await sql`
    CREATE TABLE IF NOT EXISTS adsets (
      id text PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      connection_id text NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
      campaign_id text NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      platform platform NOT NULL,
      external_id text NOT NULL,
      name text NOT NULL,
      status text NOT NULL DEFAULT 'ACTIVE',
      city_name text,
      city_region text,
      city_country text,
      radius numeric(8,2),
      distance_unit text,
      lat numeric(9,6),
      lng numeric(9,6),
      created_at timestamp NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS adset_external_unique ON adsets (connection_id, external_id)`;
  await sql`CREATE INDEX IF NOT EXISTS adset_campaign_idx ON adsets (campaign_id)`;
  await sql`CREATE INDEX IF NOT EXISTS adset_workspace_idx ON adsets (workspace_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS adset_metrics_daily (
      id text PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      adset_id text NOT NULL REFERENCES adsets(id) ON DELETE CASCADE,
      date date NOT NULL,
      spend numeric(12,2) NOT NULL DEFAULT '0',
      impressions integer NOT NULL DEFAULT 0,
      clicks integer NOT NULL DEFAULT 0,
      leads integer NOT NULL DEFAULT 0,
      conversions integer NOT NULL DEFAULT 0,
      extra jsonb
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS adset_metrics_daily_unique ON adset_metrics_daily (adset_id, date)`;
  await sql`CREATE INDEX IF NOT EXISTS adset_metrics_workspace_date_idx ON adset_metrics_daily (workspace_id, date)`;

  console.log("adsets + adset_metrics_daily tables ensured.");
  await sql.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
