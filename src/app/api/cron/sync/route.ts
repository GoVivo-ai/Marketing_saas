import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema, isDatabaseConfigured } from "@/lib/db";
import { syncConnection } from "@/lib/sync";
import { scorePendingLeads } from "@/lib/ai/lead-scoring";

export const maxDuration = 300;

/**
 * Nightly sync: pulls campaigns, daily metrics and leads for every active
 * connection. Triggered by Vercel Cron (see vercel.json) or manually:
 *
 *   curl -X POST /api/cron/sync -H "Authorization: Bearer $CRON_SECRET"
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const activeConnections = await db()
    .select()
    .from(schema.connections)
    .where(eq(schema.connections.status, "active"));

  const results = [];
  for (const conn of activeConnections) {
    const [run] = await db()
      .insert(schema.syncRuns)
      .values({ connectionId: conn.id })
      .returning();
    try {
      const stats = await syncConnection(conn.id, { days: 30 });
      await db()
        .update(schema.syncRuns)
        .set({ status: "success", finishedAt: new Date(), stats })
        .where(eq(schema.syncRuns.id, run.id));
      results.push({ connection: conn.id, status: "success", stats });
    } catch (err) {
      await db()
        .update(schema.syncRuns)
        .set({
          status: "failed",
          finishedAt: new Date(),
          error: err instanceof Error ? err.message : String(err),
        })
        .where(eq(schema.syncRuns.id, run.id));
      results.push({ connection: conn.id, status: "failed" });
    }
  }

  // Drain pending AI scores so no lead stays unscored (also retries failures).
  const workspaceIds = [...new Set(activeConnections.map((c) => c.workspaceId))];
  const scored: Record<string, { scored: number; remaining: number }> = {};
  for (const wsId of workspaceIds) {
    try {
      scored[wsId] = await scorePendingLeads(wsId, 100);
    } catch {
      // non-fatal
    }
  }

  return NextResponse.json({ synced: results.length, results, scored });
}
