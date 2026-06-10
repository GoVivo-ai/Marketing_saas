import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema, isDatabaseConfigured } from "@/lib/db";
import { syncConnection } from "@/lib/sync";

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

  return NextResponse.json({ synced: results.length, results });
}
