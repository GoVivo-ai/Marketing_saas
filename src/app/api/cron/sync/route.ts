import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema, isDatabaseConfigured } from "@/lib/db";
import { syncConnection } from "@/lib/sync";
import { scorePendingLeads } from "@/lib/ai/lead-scoring";
import { syncAllCallLogs } from "@/lib/call-log-sync";

export const maxDuration = 300;

// Fails closed when CRON_SECRET is unset. Constant-time compare so the
// secret can't be probed byte-by-byte through response timing.
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/**
 * Nightly sync: pulls campaigns, daily metrics and leads for every active
 * connection. Vercel Cron invokes this path with GET (see vercel.json);
 * manual triggers can use either method:
 *
 *   curl /api/cron/sync -H "Authorization: Bearer $CRON_SECRET"
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
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

  // Mirror the RingCentral call log for every connected user so agent talk
  // time on the Agent Activity report stays a day fresh at most.
  let callLog: unknown = null;
  try {
    callLog = await syncAllCallLogs();
  } catch (err) {
    callLog = { error: err instanceof Error ? err.message : String(err) };
  }

  return NextResponse.json({ synced: results.length, results, scored, callLog });
}

export const POST = GET;
