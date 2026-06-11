/**
 * Runs a full sync for every active connection (or one workspace).
 *
 *   npm run sync            # all active connections, last 30 days
 *   npm run sync -- fts 90  # only the fts workspace, last 90 days
 */
process.loadEnvFile(".env.local");

import { eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { syncConnection } from "../src/lib/sync";

async function main() {
  const [slug, daysArg] = process.argv.slice(2);
  const days = daysArg ? Number(daysArg) : 30;

  let connections = await db()
    .select({
      id: schema.connections.id,
      accountId: schema.connections.accountId,
      workspaceId: schema.connections.workspaceId,
      status: schema.connections.status,
    })
    .from(schema.connections)
    .where(eq(schema.connections.status, "active"));

  if (slug) {
    const [ws] = await db()
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.slug, slug))
      .limit(1);
    if (!ws) {
      console.error(`Workspace not found: ${slug}`);
      process.exit(1);
    }
    connections = connections.filter((c) => c.workspaceId === ws.id);
  }

  if (!connections.length) {
    console.log("No active connections to sync.");
    process.exit(0);
  }

  for (const conn of connections) {
    console.log(`Syncing ${conn.accountId} (last ${days} days)…`);
    const stats = await syncConnection(conn.id, { days });
    console.log(
      `  ✓ campaigns=${stats.campaigns} metricRows=${stats.metricRows} adsets=${stats.adsets} adsetMetrics=${stats.adsetMetricRows} leads=${stats.leads} scored=${stats.leadsScored}` +
        (stats.leadsError ? `\n  ⚠ leads failed: ${stats.leadsError.slice(0, 200)}` : ""),
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
