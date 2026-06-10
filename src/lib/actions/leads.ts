"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import {
  ringOut,
  sendSms,
  normalizeE164,
  RingCentralNotConnectedError,
} from "@/lib/integrations/ringcentral";

export type LeadContactResult =
  | { ok: true }
  | {
      ok: false;
      reason: "no_phone" | "bad_phone" | "not_connected" | "error";
      message?: string;
    };

/**
 * Loads the lead and authorizes the current user: agency roles can reach any
 * lead; a client must be a member of the lead's workspace.
 */
async function requireLeadAccess(leadId: string) {
  const session = await auth();
  const userId = session?.user?.id;
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!userId) throw new Error("Unauthorized");

  const [lead] = await db()
    .select({
      id: schema.leads.id,
      workspaceId: schema.leads.workspaceId,
      phone: schema.leads.phone,
    })
    .from(schema.leads)
    .where(eq(schema.leads.id, leadId))
    .limit(1);
  if (!lead) throw new Error("Lead not found");

  const isAgency = role === "agency_admin" || role === "agency_member";
  if (!isAgency) {
    const [member] = await db()
      .select({ id: schema.workspaceMembers.id })
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, lead.workspaceId),
          eq(schema.workspaceMembers.userId, userId),
        ),
      )
      .limit(1);
    if (!member) throw new Error("Forbidden");
  }
  return { userId, lead };
}

export async function callLead(leadId: string): Promise<LeadContactResult> {
  const { userId, lead } = await requireLeadAccess(leadId);
  if (!lead.phone) return { ok: false, reason: "no_phone" };

  let to: string;
  try {
    to = normalizeE164(lead.phone);
  } catch {
    return { ok: false, reason: "bad_phone" };
  }

  try {
    const res = await ringOut(userId, to);
    await db().insert(schema.leadEvents).values({
      leadId,
      userId,
      type: "call",
      payload: { to, ringOutId: res.id, via: "ringcentral" },
    });
    revalidatePath("/leads");
    return { ok: true };
  } catch (err) {
    if (err instanceof RingCentralNotConnectedError)
      return { ok: false, reason: "not_connected" };
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function smsLead(
  leadId: string,
  text: string,
): Promise<LeadContactResult> {
  const { userId, lead } = await requireLeadAccess(leadId);
  const body = text.trim();
  if (!body) return { ok: false, reason: "error", message: "Message is empty" };
  if (!lead.phone) return { ok: false, reason: "no_phone" };

  let to: string;
  try {
    to = normalizeE164(lead.phone);
  } catch {
    return { ok: false, reason: "bad_phone" };
  }

  try {
    const res = await sendSms(userId, to, body);
    await db().insert(schema.leadEvents).values({
      leadId,
      userId,
      type: "sms",
      payload: { to, text: body, messageId: res.id, via: "ringcentral" },
    });
    revalidatePath("/leads");
    return { ok: true };
  } catch (err) {
    if (err instanceof RingCentralNotConnectedError)
      return { ok: false, reason: "not_connected" };
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
