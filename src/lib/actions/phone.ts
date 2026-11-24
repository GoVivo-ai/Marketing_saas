"use server";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { isDemoSession, DEMO_BLOCKED_MSG } from "@/lib/demo";
import { leadWorkspaceScope, matchLeadByPhone } from "@/lib/lead-phone-scope";
import { getWorkspaceContext } from "@/lib/data";
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
  const scope = await leadWorkspaceScope(userId);
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
    // A lead's name only shows when the user may see that lead's workspace.
    .leftJoin(
      schema.leads,
      and(
        eq(schema.leads.id, schema.callLogs.leadId),
        scope ? (scope.length ? inArray(schema.leads.workspaceId, scope) : sql`false`) : undefined,
      ),
    )
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
      leadId: r.leadName === null ? null : r.leadId,
      leadName: r.leadName,
    };
  });
}

/** Who a number belongs to, for the keypad's caller-id line. */
export async function lookupLeadByPhone(
  phone: string,
): Promise<{ leadId: string; name: string } | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Unauthorized");
  const { active } = await getWorkspaceContext();
  const match = await matchLeadByPhone(phone, await leadWorkspaceScope(userId), active?.id);
  if (!match) return null;
  const [lead] = await db()
    .select({ name: schema.leads.name })
    .from(schema.leads)
    .where(eq(schema.leads.id, match.leadId))
    .limit(1);
  return { leadId: match.leadId, name: lead?.name ?? "Lead" };
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

  const { active } = await getWorkspaceContext();
  const lead = await matchLeadByPhone(e164, await leadWorkspaceScope(userId), active?.id);
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
