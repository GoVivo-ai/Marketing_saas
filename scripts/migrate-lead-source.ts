/**
 * Adds leads.source — the acquisition channel (Meta Ads / Website / Manual),
 * which used to be implied by `platform`. Backfills every existing lead from
 * its platform and, for hand-entered ones, the `formData.source` marker the
 * public /join form writes. Idempotent.
 * Run: npx tsx scripts/migrate-lead-source.ts
 */
import { inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { deriveLeadSource } from "../src/lib/lead-source";

if (!process.env.DATABASE_URL) {
  process.loadEnvFile(".env.local");
}

async function main() {
  await db().execute(
    sql`ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "source" text`,
  );
  await db().execute(
    sql`CREATE INDEX IF NOT EXISTS "lead_workspace_source_idx" ON "leads" ("workspace_id", "source")`,
  );

  const pending = await db()
    .select({
      id: schema.leads.id,
      platform: schema.leads.platform,
      formData: schema.leads.formData,
    })
    .from(schema.leads)
    .where(isNull(schema.leads.source));

  // Group by the derived channel and write one UPDATE per group (chunked, so
  // the id list stays inside Postgres' parameter limit). Row-by-row updates
  // would be thousands of round trips.
  const idsBySource = new Map<string, string[]>();
  for (const l of pending) {
    const source = deriveLeadSource(
      l.platform,
      l.formData as Record<string, unknown> | null,
    );
    const bucket = idsBySource.get(source);
    if (bucket) bucket.push(l.id);
    else idsBySource.set(source, [l.id]);
  }

  const CHUNK = 500;
  for (const [source, ids] of idsBySource) {
    for (let i = 0; i < ids.length; i += CHUNK) {
      await db()
        .update(schema.leads)
        .set({ source })
        .where(inArray(schema.leads.id, ids.slice(i, i + CHUNK)));
    }
  }
  const n = pending.length;

  const mix = await db()
    .select({ source: schema.leads.source, n: sql<number>`count(*)::int` })
    .from(schema.leads)
    .groupBy(schema.leads.source);
  console.log(`leads.source ready — backfilled ${n}`);
  console.table(mix);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
