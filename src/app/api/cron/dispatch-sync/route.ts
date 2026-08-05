import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  connectedDispatchWorkspaces,
  syncDispatchInteractions,
} from "@/lib/dispatch-sync";

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
 * Daily sync of each connected workspace's SharePoint list into the dispatch
 * module (see vercel.json). One failing workspace doesn't stop the rest.
 * Manual trigger:
 *
 *   curl /api/cron/dispatch-sync -H "Authorization: Bearer $CRON_SECRET"
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const workspaceIds = await connectedDispatchWorkspaces();
  if (workspaceIds.length === 0) {
    return NextResponse.json({ ok: true, synced: [], note: "no connections" });
  }
  const results: Record<string, unknown> = {};
  for (const ws of workspaceIds) {
    try {
      results[ws] = await syncDispatchInteractions(ws);
    } catch (err) {
      results[ws] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  return NextResponse.json({ ok: true, results });
}
