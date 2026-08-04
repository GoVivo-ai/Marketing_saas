import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isGraphConfigured } from "@/lib/integrations/ms-graph";
import { syncDispatchInteractions } from "@/lib/dispatch-sync";

export const maxDuration = 300;

const ALEXYAH_WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63";

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
 * Daily sync of the SharePoint Driver Incidents Report into the dispatch
 * module (see vercel.json). Manual trigger:
 *
 *   curl /api/cron/dispatch-sync -H "Authorization: Bearer $CRON_SECRET"
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isGraphConfigured()) {
    return NextResponse.json(
      { error: "Microsoft Graph is not configured" },
      { status: 503 },
    );
  }
  try {
    const result = await syncDispatchInteractions(ALEXYAH_WS);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
