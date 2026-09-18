import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import {
  ingestCareersApplication,
  notifyCareersApplication,
  type CareersApplication,
} from "@/lib/careers-intake";

export const dynamic = "force-dynamic";

/**
 * Inbound webhook from Vivo's careers site (govivo.ai). The site POSTs
 * `{ event: "application.created", data: {...row}, sent_at }` with the shared
 * secret in `x-webhook-secret`; each application becomes a lead in the Vivo
 * workspace and the recruiting channel hears about it.
 *
 * Env:
 *   APPLY_WEBHOOK_SECRET     shared with the site (its APPLY_WEBHOOK_SECRET)
 *   APPLY_WORKSPACE_SLUG     where applicants land (default "vivo")
 *   APPLY_SLACK_WEBHOOK_URL  Slack incoming webhook for the notification
 */
export async function POST(req: NextRequest) {
  const secret = process.env.APPLY_WEBHOOK_SECRET;
  if (!secret)
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  if (!sameSecret(req.headers.get("x-webhook-secret"), secret))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!isDatabaseConfigured())
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const body = (await req.json().catch(() => null)) as
    | { event?: string; data?: CareersApplication }
    | null;
  if (!body?.event || !body.data)
    return NextResponse.json({ error: "Malformed payload" }, { status: 400 });
  // Other events (edits, deletions) are the site's business; acknowledge so
  // the sender doesn't retry, and do nothing.
  if (body.event !== "application.created")
    return NextResponse.json({ ok: true, ignored: body.event });
  if (body.data.id === undefined || body.data.id === null)
    return NextResponse.json({ error: "Application has no id" }, { status: 400 });

  const slug = process.env.APPLY_WORKSPACE_SLUG ?? "vivo";
  try {
    const result = await ingestCareersApplication(slug, body.data);
    if (result.created) await notifyCareersApplication(body.data, result.leadId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[careers-webhook] failed:", err);
    return NextResponse.json({ error: "Ingest failed" }, { status: 500 });
  }
}

function sameSecret(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
