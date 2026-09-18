import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema, isDatabaseConfigured } from "@/lib/db";
import {
  ingestInboundLead,
  normaliseInbound,
  notifyInboundLead,
} from "@/lib/inbound-leads";

export const dynamic = "force-dynamic";

/**
 * Inbound lead webhook. The token in the path is the credential: an admin
 * generates the URL in Settings → Connections and pastes it into the tool
 * that posts leads. POST JSON — a flat lead, or `{ event, data }`.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!isDatabaseConfigured())
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { token } = await params;
  const [hook] = await db()
    .select()
    .from(schema.inboundWebhooks)
    .where(eq(schema.inboundWebhooks.token, token))
    .limit(1);
  // Unknown and retired tokens look the same from outside.
  if (!hook) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object")
    return NextResponse.json({ error: "Expected a JSON object" }, { status: 400 });

  const lead = normaliseInbound(body);
  // An envelope for some other event: acknowledge so the sender doesn't retry.
  if (!lead) return NextResponse.json({ ok: true, ignored: true });
  if (!lead.email && !lead.phone)
    return NextResponse.json(
      { error: "A lead needs at least an email or a phone" },
      { status: 400 },
    );

  try {
    const result = await ingestInboundLead(hook, lead);
    if (result.created) {
      const base =
        process.env.NEXT_PUBLIC_APP_URL ??
        `${req.headers.get("x-forwarded-proto") ?? "https"}://${req.headers.get("host") ?? ""}`;
      await notifyInboundLead(hook, lead, result.leadId, base);
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[inbound-webhook] failed:", err);
    return NextResponse.json({ error: "Ingest failed" }, { status: 500 });
  }
}
