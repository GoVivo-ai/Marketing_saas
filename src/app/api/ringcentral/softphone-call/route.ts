import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db, schema, isDatabaseConfigured } from "@/lib/db";
import { matchLeadByPhone } from "@/lib/call-log-sync";

/**
 * A finished call, reported by our own softphone.
 *
 * This is the fast path, not the record of truth: it puts the call on screen
 * within seconds, while the nightly RingCentral sync later overwrites the
 * same row with the carrier's own duration and result. Both key on the SIP
 * call id, so they meet on one row instead of double counting.
 *
 * Duration is measured from answer, not from dial — ringing time is not talk
 * time, and the reports treat long calls as evidence a real conversation
 * happened.
 */

const BodySchema = z.object({
  callId: z.string().min(1).max(200),
  direction: z.enum(["inbound", "outbound"]),
  remoteNumber: z.string().max(64),
  startedAt: z.string().datetime(),
  answeredAt: z.string().datetime().nullable(),
  endedAt: z.string().datetime(),
  state: z.enum(["ringing", "answered", "ended", "failed"]),
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

  const answered = b.answeredAt ? new Date(b.answeredAt) : null;
  const durationSec = answered
    ? Math.max(0, Math.round((new Date(b.endedAt).getTime() - answered.getTime()) / 1000))
    : 0;
  const result = answered ? "Call connected" : b.state === "failed" ? "Failed" : "Missed";

  const lead = await matchLeadByPhone(b.remoteNumber);

  await db()
    .insert(schema.callLogs)
    .values({
      userId,
      externalId: b.callId,
      direction: b.direction === "inbound" ? "Inbound" : "Outbound",
      fromNumber: b.direction === "inbound" ? b.remoteNumber : null,
      toNumber: b.direction === "outbound" ? b.remoteNumber : null,
      startTime: new Date(b.startedAt),
      durationSec,
      result,
      leadId: lead?.leadId ?? null,
      workspaceId: lead?.workspaceId ?? null,
    })
    .onConflictDoUpdate({
      target: [schema.callLogs.userId, schema.callLogs.externalId],
      set: { durationSec, result },
    });

  return NextResponse.json({ ok: true, matched: Boolean(lead) });
}
