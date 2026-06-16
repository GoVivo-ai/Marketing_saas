"use server";

import { revalidatePath } from "next/cache";
import { and, asc, desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import {
  placeCall,
  sendText,
  normalizeE164,
  NoProviderConnectedError,
} from "@/lib/integrations/telephony";
import { isValidRcaPath } from "@/lib/rca";
import {
  OUTREACH_CHANNELS,
  OUTREACH_OUTCOMES,
  type OutreachChannel,
  type OutreachOutcome,
  type LeadActivityItem,
} from "@/lib/outreach";

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

// ─────────────────────────────────────────────────────────────────────────
// Manual activity log — replaces the spreadsheet's outreach columns
// (1st/2nd/3rd outreach, called/VM/contacted, comments, replied) with an
// unbounded chronological timeline the ops team writes directly in the app.
// ─────────────────────────────────────────────────────────────────────────

/** Full chronological history for a lead (newest first), authorized. */
export async function getLeadActivity(
  leadId: string,
): Promise<LeadActivityItem[]> {
  await requireLeadAccess(leadId);
  const events = await db()
    .select({
      id: schema.leadEvents.id,
      type: schema.leadEvents.type,
      payload: schema.leadEvents.payload,
      createdAt: schema.leadEvents.createdAt,
      actor: schema.users.name,
    })
    .from(schema.leadEvents)
    .leftJoin(schema.users, eq(schema.leadEvents.userId, schema.users.id))
    .where(eq(schema.leadEvents.leadId, leadId))
    .orderBy(desc(schema.leadEvents.createdAt));

  // Resolve stage ids referenced by status_change events to names.
  const [{ workspaceId }] = await db()
    .select({ workspaceId: schema.leads.workspaceId })
    .from(schema.leads)
    .where(eq(schema.leads.id, leadId))
    .limit(1);
  const stageRows = await db()
    .select({ id: schema.stages.id, name: schema.stages.name })
    .from(schema.stages)
    .where(eq(schema.stages.workspaceId, workspaceId));
  const stageName = new Map(stageRows.map((s) => [s.id, s.name]));

  return events.map((e) => {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    let text: string | null = null;
    if (e.type === "note") text = (p.text as string) ?? null;
    else if (e.type === "status_change") {
      const to = stageName.get(p.toStageId as string);
      text = to ? `Moved to ${to}` : "Stage changed";
    } else if (e.type === "disqualified") {
      const path = [p.l1, p.l2, p.l3].filter(Boolean).join(" › ");
      const note = (p.note as string) ?? "";
      text = note ? `${path}\n${note}` : path || null;
    } else {
      // call / sms / email / whatsapp — prefer the agent's comment, fall back
      // to the SMS body for texts placed through the platform.
      text = (p.note as string) ?? (p.text as string) ?? null;
    }
    return {
      id: e.id,
      type: e.type,
      manual: p.manual === true,
      outcome: (p.outcome as OutreachOutcome) ?? null,
      text,
      actor: e.actor,
      at: e.createdAt.toISOString(),
    };
  });
}

export type LeadLogResult =
  | { ok: true }
  | { ok: false; message: string };

/** Adds a free-text note (the spreadsheet's Comments / Sub-comments). */
export async function addLeadNote(
  leadId: string,
  text: string,
): Promise<LeadLogResult> {
  const { userId } = await requireLeadAccess(leadId);
  const body = text.trim();
  if (!body) return { ok: false, message: "Note is empty" };
  if (body.length > 2000)
    return { ok: false, message: "Note is too long (2000 chars max)." };
  try {
    await db().insert(schema.leadEvents).values({
      leadId,
      userId,
      type: "note",
      payload: { text: body },
    });
    revalidatePath("/leads");
    revalidatePath("/leads/pipeline");
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Logs a contact attempt the agent made outside the platform (or to record the
 * outcome of one). A positive outcome auto-advances the lead, mirroring how a
 * real conversation moves it down the funnel.
 */
export async function logLeadOutreach(
  leadId: string,
  input: { channel: OutreachChannel; outcome: OutreachOutcome; note?: string },
): Promise<LeadLogResult> {
  if (!OUTREACH_CHANNELS.includes(input.channel))
    return { ok: false, message: "Invalid channel" };
  if (!OUTREACH_OUTCOMES.includes(input.outcome))
    return { ok: false, message: "Invalid outcome" };
  const { userId, lead } = await requireLeadAccess(leadId);
  const note = input.note?.trim() || null;
  try {
    await db().insert(schema.leadEvents).values({
      leadId,
      userId,
      type: input.channel,
      payload: { manual: true, outcome: input.outcome, note },
    });
    if (input.outcome === "answered" || input.outcome === "replied")
      await maybeAutoAdvance(lead, userId);
    revalidatePath("/leads");
    revalidatePath("/leads/pipeline");
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Records why a lead was lost/not-qualified using the RCA taxonomy
 * (src/lib/rca.ts) — the spreadsheet's RCA Lvl 1/2/3. Stored on the lead for
 * filtering/reporting and appended to the activity log.
 */
export async function setLeadDisqual(
  leadId: string,
  input: { l1: string; l2: string; l3: string; note?: string },
): Promise<LeadLogResult> {
  if (!isValidRcaPath(input.l1, input.l2, input.l3))
    return { ok: false, message: "Invalid disqualification reason" };
  const { userId } = await requireLeadAccess(leadId);
  const note = input.note?.trim() || null;
  try {
    await db()
      .update(schema.leads)
      .set({
        disqualL1: input.l1,
        disqualL2: input.l2,
        disqualL3: input.l3,
        updatedAt: new Date(),
      })
      .where(eq(schema.leads.id, leadId));
    await db().insert(schema.leadEvents).values({
      leadId,
      userId,
      type: "disqualified",
      payload: { l1: input.l1, l2: input.l2, l3: input.l3, note },
    });
    revalidatePath("/leads");
    revalidatePath("/leads/pipeline");
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Clears a lead's disqualification reason (e.g. it was re-opened). */
export async function clearLeadDisqual(leadId: string): Promise<LeadLogResult> {
  const { userId } = await requireLeadAccess(leadId);
  try {
    await db()
      .update(schema.leads)
      .set({ disqualL1: null, disqualL2: null, disqualL3: null, updatedAt: new Date() })
      .where(eq(schema.leads.id, leadId));
    await db().insert(schema.leadEvents).values({
      leadId,
      userId,
      type: "note",
      payload: { text: "Disqualification reason cleared." },
    });
    revalidatePath("/leads");
    revalidatePath("/leads/pipeline");
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
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
