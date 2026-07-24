import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db, schema, isDatabaseConfigured } from "@/lib/db";
import { matchLeadByPhone } from "@/lib/call-log-sync";

/**
 * Client-side call capture from the RingCentral Embeddable widget. Agents
 * sign in INSIDE the iframe (RingCentral's origin), so the server never gets
 * OAuth tokens for them — instead the dialer listens for the widget's
 * rc-call-end-notify postMessage and reports each finished call here. The
 * externalId is the RC telephony session id, the same key the server-side
 * call-log sync uses, so a user who later connects OAuth in Settings doesn't
 * get duplicate rows.
 */

const BodySchema = z.object({
  externalId: z.string().min(1).max(200),
  direction: z.enum(["Inbound", "Outbound"]).nullish(),
  from: z.string().max(64).nullish(),
  to: z.string().max(64).nullish(),
  /** Epoch milliseconds of when the call started. */
  startTime: z.number().int().positive(),
  durationSec: z.number().int().min(0).max(24 * 60 * 60),
  result: z.string().max(100).nullish(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDatabaseConfigured())
    return NextResponse.json({ error: "No database" }, { status: 503 });

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const b = parsed.data;

  const counterparty = b.direction === "Inbound" ? b.from : b.to;
  const lead = await matchLeadByPhone(counterparty);

  await db()
    .insert(schema.callLogs)
    .values({
      userId,
      externalId: b.externalId,
      direction: b.direction ?? null,
      fromNumber: b.from ?? null,
      toNumber: b.to ?? null,
      startTime: new Date(b.startTime),
      durationSec: b.durationSec,
      result: b.result ?? (b.durationSec > 0 ? "Call connected" : "Missed"),
      leadId: lead?.leadId ?? null,
      workspaceId: lead?.workspaceId ?? null,
    })
    .onConflictDoUpdate({
      target: [schema.callLogs.userId, schema.callLogs.externalId],
      set: {
        durationSec: b.durationSec,
        result: b.result ?? (b.durationSec > 0 ? "Call connected" : "Missed"),
      },
    });

  return NextResponse.json({ ok: true, matched: Boolean(lead) });
}
