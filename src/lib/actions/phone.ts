"use server";

import { desc, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { isDemoSession, DEMO_BLOCKED_MSG } from "@/lib/demo";
import { matchLeadByPhone, phoneKey } from "@/lib/call-log-sync";
import {
  sendText,
  normalizeE164,
  BadPhoneError,
  NoProviderConnectedError,
} from "@/lib/integrations/telephony";

/** One row of the phone's Recent tab. */
export interface RecentCall {
  id: string;
  direction: "inbound" | "outbound";
  /** The other party, as the carrier reported it. */
  number: string;
  startTime: Date;
  durationSec: number;
  /** "Call connected" | "Missed" | "Voicemail" | … */
  result: string | null;
  missed: boolean;
  leadId: string | null;
  leadName: string | null;
}

/** The current user's latest calls, newest first, with the lead they matched. */
export async function listRecentCalls(limit = 30): Promise<RecentCall[]> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Unauthorized");
  const rows = await db()
    .select({
      id: schema.callLogs.id,
      direction: schema.callLogs.direction,
      fromNumber: schema.callLogs.fromNumber,
      toNumber: schema.callLogs.toNumber,
      startTime: schema.callLogs.startTime,
      durationSec: schema.callLogs.durationSec,
      result: schema.callLogs.result,
      leadId: schema.callLogs.leadId,
      leadName: schema.leads.name,
    })
    .from(schema.callLogs)
    .leftJoin(schema.leads, eq(schema.leads.id, schema.callLogs.leadId))
    .where(eq(schema.callLogs.userId, userId))
    .orderBy(desc(schema.callLogs.startTime))
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows.map((r) => {
    const inbound = (r.direction ?? "").toLowerCase() === "inbound";
    const result = r.result ?? null;
    return {
      id: r.id,
      direction: inbound ? "inbound" : "outbound",
      number: (inbound ? r.fromNumber : r.toNumber) ?? r.toNumber ?? r.fromNumber ?? "",
      startTime: r.startTime,
      durationSec: r.durationSec,
      result,
      missed:
        inbound &&
        (r.durationSec === 0 || /missed|voicemail|no answer|rejected/i.test(result ?? "")),
      leadId: r.leadId,
      leadName: r.leadName,
    };
  });
}

/** Who a number belongs to, for the keypad's caller-id line. */
export async function lookupLeadByPhone(
  phone: string,
): Promise<{ leadId: string; name: string } | null> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const key = phoneKey(phone);
  if (!key) return null;
  const [lead] = await db()
    .select({ id: schema.leads.id, name: schema.leads.name })
    .from(schema.leads)
    .where(sql`right(regexp_replace(${schema.leads.phone}, '\\D', '', 'g'), 10) = ${key}`)
    .orderBy(desc(schema.leads.createdAt))
    .limit(1);
  return lead ? { leadId: lead.id, name: lead.name ?? "Lead" } : null;
}

export type SendSmsResult =
  | { ok: true; leadId: string | null }
  | { ok: false; reason: "bad_phone" | "not_connected" | "empty" | "error"; message?: string };

/**
 * SMS to any number from the phone's Messages tab. Goes out through the
 * agent's own connected number; when the number belongs to a lead the send
 * is also logged on that lead, so the queue and the activity timeline see it.
 */
export async function sendSmsToNumber(to: string, text: string): Promise<SendSmsResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Unauthorized");
  if (await isDemoSession()) return { ok: false, reason: "error", message: DEMO_BLOCKED_MSG };
  const body = text.trim();
  if (!body) return { ok: false, reason: "empty" };
  if (body.length > 1600) return { ok: false, reason: "error", message: "Message is too long." };

  let e164: string;
  try {
    // Keypad entries come without "+"; assume US when 10 digits are typed.
    const digits = to.replace(/\D/g, "");
    e164 = normalizeE164(
      to.trim().startsWith("+") ? to : digits.length === 10 ? `+1${digits}` : `+${digits}`,
    );
  } catch (err) {
    if (err instanceof BadPhoneError) return { ok: false, reason: "bad_phone" };
    throw err;
  }

  let sent: Awaited<ReturnType<typeof sendText>>;
  try {
    sent = await sendText(userId, e164, body);
  } catch (err) {
    if (err instanceof NoProviderConnectedError) return { ok: false, reason: "not_connected" };
    return { ok: false, reason: "error", message: err instanceof Error ? err.message : String(err) };
  }

  const lead = await matchLeadByPhone(e164);
  if (lead) {
    await db().insert(schema.leadEvents).values({
      leadId: lead.leadId,
      userId,
      type: "sms",
      payload: { manual: false, outcome: "sent", to: e164, text: body, messageId: sent.id, via: sent.via },
    });
  }
  return { ok: true, leadId: lead?.leadId ?? null };
}
