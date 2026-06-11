"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import {
  placeCall,
  sendText,
  normalizeE164,
  NoProviderConnectedError,
} from "@/lib/integrations/telephony";

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
      stageId: schema.leads.stageId,
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

type LeadStatus = "new" | "contacted" | "qualified" | "won" | "lost";

/** Keep the legacy status enum loosely in sync with the lead's stage. */
function deriveStatus(kind: string, position: number): LeadStatus {
  if (kind === "won") return "won";
  if (kind === "lost") return "lost";
  return position === 0 ? "new" : "contacted";
}

/** On first contact, advance a lead in the first open stage to the next open one. */
async function maybeAutoAdvance(
  lead: { id: string; workspaceId: string; stageId: string | null },
  userId: string,
) {
  const stages = await db()
    .select({
      id: schema.stages.id,
      position: schema.stages.position,
      kind: schema.stages.kind,
    })
    .from(schema.stages)
    .where(eq(schema.stages.workspaceId, lead.workspaceId))
    .orderBy(asc(schema.stages.position));
  const firstOpen = stages.find((s) => s.kind === "open");
  if (!firstOpen || lead.stageId !== firstOpen.id) return;
  const next = stages.find(
    (s) => s.position > firstOpen.position && s.kind === "open",
  );
  if (!next) return;
  await db()
    .update(schema.leads)
    .set({
      stageId: next.id,
      status: deriveStatus(next.kind, next.position),
      updatedAt: new Date(),
    })
    .where(eq(schema.leads.id, lead.id));
  await db().insert(schema.leadEvents).values({
    leadId: lead.id,
    userId,
    type: "status_change",
    payload: { toStageId: next.id, reason: "auto_contacted" },
  });
}

export type LeadStageResult =
  | { ok: true }
  | { ok: false; reason: "invalid_stage" | "error"; message?: string };

/** Moves a lead to a stage (drag & drop or the detail Select) and logs it. */
export async function moveLeadToStage(
  leadId: string,
  stageId: string,
): Promise<LeadStageResult> {
  const { userId, lead } = await requireLeadAccess(leadId);
  const [stage] = await db()
    .select({
      id: schema.stages.id,
      workspaceId: schema.stages.workspaceId,
      kind: schema.stages.kind,
      position: schema.stages.position,
    })
    .from(schema.stages)
    .where(eq(schema.stages.id, stageId))
    .limit(1);
  if (!stage || stage.workspaceId !== lead.workspaceId)
    return { ok: false, reason: "invalid_stage" };
  if (lead.stageId === stageId) return { ok: true };

  try {
    await db()
      .update(schema.leads)
      .set({
        stageId,
        status: deriveStatus(stage.kind, stage.position),
        updatedAt: new Date(),
      })
      .where(eq(schema.leads.id, leadId));
    await db().insert(schema.leadEvents).values({
      leadId,
      userId,
      type: "status_change",
      payload: { fromStageId: lead.stageId, toStageId: stageId },
    });
    revalidatePath("/leads/pipeline");
    revalidatePath("/leads");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
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
    const res = await placeCall(userId, to);
    await db().insert(schema.leadEvents).values({
      leadId,
      userId,
      type: "call",
      payload: { to, callId: res.id, via: res.via },
    });
    await maybeAutoAdvance(lead, userId);
    revalidatePath("/leads");
    revalidatePath("/leads/pipeline");
    return { ok: true };
  } catch (err) {
    if (err instanceof NoProviderConnectedError)
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
    const res = await sendText(userId, to, body);
    await db().insert(schema.leadEvents).values({
      leadId,
      userId,
      type: "sms",
      payload: { to, text: body, messageId: res.id, via: res.via },
    });
    await maybeAutoAdvance(lead, userId);
    revalidatePath("/leads");
    revalidatePath("/leads/pipeline");
    return { ok: true };
  } catch (err) {
    if (err instanceof NoProviderConnectedError)
      return { ok: false, reason: "not_connected" };
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
