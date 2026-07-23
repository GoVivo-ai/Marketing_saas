"use server";

import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { currentUser, isAgency, getWorkspaceRole } from "@/lib/permissions";
import { geocodeCityCached } from "@/lib/integrations/geocode";
import {
  placeCall,
  sendText,
  normalizeE164,
  NoProviderConnectedError,
} from "@/lib/integrations/telephony";
import { isValidRcaPath } from "@/lib/rca";
import { getLeadRowById, type LeadRow } from "@/lib/data";
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
    // fromStageId lets undoLeadOutreach revert the advance.
    payload: { fromStageId: firstOpen.id, toStageId: next.id, reason: "auto_contacted" },
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
  | { ok: true; eventId?: string }
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

export type LeadUpdateResult = { ok: true } | { ok: false; message: string };

/** Empty/whitespace → null, so cleared fields are stored as NULL not "". */
const nullify = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t.length ? t : null;
};

/**
 * Edits a lead's contact fields (name/phone/email) and its form responses
 * (`formData`). Agents use this to fix bad or missing data that came in from
 * the ad platform. Overwrites `formData` wholesale with the map the client
 * sends (empty keys dropped); re-sync never touches `formData`, so manual edits
 * are safe from being clobbered.
 */
export async function updateLeadInfo(input: {
  leadId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  formData: Record<string, string>;
}): Promise<LeadUpdateResult> {
  const { lead } = await requireLeadAccess(input.leadId);

  // Keep only non-empty keys, trimmed; values stay strings (as the platform
  // delivers them). Guards against a stray blank row from the editor.
  const formData: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(input.formData ?? {})) {
    const key = rawKey.trim();
    if (key) formData[key] = typeof rawValue === "string" ? rawValue : String(rawValue);
  }

  try {
    await db()
      .update(schema.leads)
      .set({
        name: nullify(input.name),
        phone: nullify(input.phone),
        email: nullify(input.email),
        formData,
        updatedAt: new Date(),
      })
      .where(eq(schema.leads.id, lead.id));
    revalidatePath("/leads");
    revalidatePath("/leads/pipeline");
    revalidatePath("/leads/queue");
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
  if (note && note.length > 2000)
    return { ok: false, message: "Note is too long (2000 chars max)." };
  try {
    const [event] = await db()
      .insert(schema.leadEvents)
      .values({
        leadId,
        userId,
        type: input.channel,
        payload: { manual: true, outcome: input.outcome, note },
      })
      .returning({ id: schema.leadEvents.id });
    if (input.outcome === "answered" || input.outcome === "replied")
      await maybeAutoAdvance(lead, userId);
    revalidatePath("/leads");
    revalidatePath("/leads/pipeline");
    return { ok: true, eventId: event.id };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** How long a just-logged touch stays undoable. */
const UNDO_WINDOW_MS = 15 * 60_000;

/**
 * Undoes a touch the agent just mis-logged from the queue: deletes the event
 * and, if that touch auto-advanced the lead, moves it back. Only the author
 * can undo, and only within a short window — corrections after that belong
 * in the activity log as notes, not as rewritten history.
 */
export async function undoLeadOutreach(
  leadId: string,
  eventId?: string | null,
): Promise<LeadLogResult> {
  const { userId, lead } = await requireLeadAccess(leadId);
  try {
    // Prefer the exact event the UI points at; when the client didn't capture
    // an id, fall back to this user's most recent manual touch on the lead so
    // the Undo button still works instead of silently doing nothing.
    const candidates = await db()
      .select({
        id: schema.leadEvents.id,
        leadId: schema.leadEvents.leadId,
        userId: schema.leadEvents.userId,
        type: schema.leadEvents.type,
        payload: schema.leadEvents.payload,
        createdAt: schema.leadEvents.createdAt,
      })
      .from(schema.leadEvents)
      .where(
        eventId
          ? eq(schema.leadEvents.id, eventId)
          : and(
              eq(schema.leadEvents.leadId, leadId),
              eq(schema.leadEvents.userId, userId),
              inArray(schema.leadEvents.type, [...OUTREACH_CHANNELS]),
            ),
      )
      .orderBy(desc(schema.leadEvents.createdAt))
      .limit(eventId ? 1 : 10);

    // The most recent candidate that is actually an undoable manual touch.
    const event = candidates.find((e) => {
      const p = (e.payload ?? {}) as Record<string, unknown>;
      return (
        e.leadId === leadId &&
        e.userId === userId &&
        OUTREACH_CHANNELS.includes(e.type as OutreachChannel) &&
        p.manual === true
      );
    });
    if (!event)
      return { ok: false, message: "This touch can't be undone." };
    if (Date.now() - event.createdAt.getTime() > UNDO_WINDOW_MS)
      return { ok: false, message: "Too late to undo — add a correcting note instead." };

    // If the touch auto-advanced the lead, walk the stage back too.
    const [advance] = await db()
      .select({
        id: schema.leadEvents.id,
        payload: schema.leadEvents.payload,
      })
      .from(schema.leadEvents)
      .where(
        and(
          eq(schema.leadEvents.leadId, leadId),
          eq(schema.leadEvents.type, "status_change"),
        ),
      )
      .orderBy(desc(schema.leadEvents.createdAt))
      .limit(1);
    const advPayload = (advance?.payload ?? {}) as Record<string, unknown>;
    if (
      advance &&
      advPayload.reason === "auto_contacted" &&
      typeof advPayload.fromStageId === "string" &&
      lead.stageId === advPayload.toStageId
    ) {
      const [fromStage] = await db()
        .select({
          id: schema.stages.id,
          kind: schema.stages.kind,
          position: schema.stages.position,
        })
        .from(schema.stages)
        .where(eq(schema.stages.id, advPayload.fromStageId))
        .limit(1);
      if (fromStage) {
        await db()
          .update(schema.leads)
          .set({
            stageId: fromStage.id,
            status: deriveStatus(fromStage.kind, fromStage.position),
            updatedAt: new Date(),
          })
          .where(eq(schema.leads.id, leadId));
        await db().delete(schema.leadEvents).where(eq(schema.leadEvents.id, advance.id));
      }
    }

    await db().delete(schema.leadEvents).where(eq(schema.leadEvents.id, event.id));
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
  const { userId, lead } = await requireLeadAccess(leadId);
  const note = input.note?.trim() || null;
  if (note && note.length > 2000)
    return { ok: false, message: "Note is too long (2000 chars max)." };
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

    // A disqualified lead also leaves the open pipeline: move it to the
    // first lost-kind stage so the Kanban matches the queue's verdict.
    // fromStageId lets clearLeadDisqual walk it back on re-open.
    const stages = await db()
      .select({
        id: schema.stages.id,
        kind: schema.stages.kind,
        position: schema.stages.position,
      })
      .from(schema.stages)
      .where(eq(schema.stages.workspaceId, lead.workspaceId))
      .orderBy(asc(schema.stages.position));
    const currentKind = stages.find((s) => s.id === lead.stageId)?.kind;
    const lost = stages.find((s) => s.kind === "lost");
    if (lost && (lead.stageId == null || currentKind === "open")) {
      await db()
        .update(schema.leads)
        .set({ stageId: lost.id, status: "lost", updatedAt: new Date() })
        .where(eq(schema.leads.id, leadId));
      await db().insert(schema.leadEvents).values({
        leadId,
        userId,
        type: "status_change",
        payload: {
          fromStageId: lead.stageId,
          toStageId: lost.id,
          reason: "disqualified",
        },
      });
    }

    revalidatePath("/leads");
    revalidatePath("/leads/pipeline");
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Clears a lead's disqualification reason (e.g. it was re-opened) and, if the
 * disqualification parked it in a lost stage, walks it back into the open
 * pipeline — to the stage it was in before, or the first open stage.
 */
export async function clearLeadDisqual(leadId: string): Promise<LeadLogResult> {
  const { userId, lead } = await requireLeadAccess(leadId);
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

    const stages = await db()
      .select({
        id: schema.stages.id,
        kind: schema.stages.kind,
        position: schema.stages.position,
      })
      .from(schema.stages)
      .where(eq(schema.stages.workspaceId, lead.workspaceId))
      .orderBy(asc(schema.stages.position));
    const currentKind = stages.find((s) => s.id === lead.stageId)?.kind;
    if (currentKind === "lost") {
      // Prefer the stage it left when it was disqualified.
      const [moved] = await db()
        .select({ payload: schema.leadEvents.payload })
        .from(schema.leadEvents)
        .where(
          and(
            eq(schema.leadEvents.leadId, leadId),
            eq(schema.leadEvents.type, "status_change"),
          ),
        )
        .orderBy(desc(schema.leadEvents.createdAt))
        .limit(1);
      const p = (moved?.payload ?? {}) as Record<string, unknown>;
      const previous =
        p.reason === "disqualified" && typeof p.fromStageId === "string"
          ? stages.find((s) => s.id === p.fromStageId && s.kind === "open")
          : undefined;
      const target = previous ?? stages.find((s) => s.kind === "open");
      if (target) {
        await db()
          .update(schema.leads)
          .set({
            stageId: target.id,
            status: deriveStatus(target.kind, target.position),
            updatedAt: new Date(),
          })
          .where(eq(schema.leads.id, leadId));
        await db().insert(schema.leadEvents).values({
          leadId,
          userId,
          type: "status_change",
          payload: {
            fromStageId: lead.stageId,
            toStageId: target.id,
            reason: "reopened",
          },
        });
      }
    }

    revalidatePath("/leads");
    revalidatePath("/leads/pipeline");
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export interface ManualLeadState {
  error?: string;
  success?: string;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Creates a lead entered by hand (e.g. a direct referral from the client) —
 * the manual counterpart of the Meta sync. The lead lands in the workspace's
 * first open stage with platform "manual" and shows up everywhere synced
 * leads do (inbox, pipeline, contact queue).
 */
export async function createManualLead(
  _prev: ManualLeadState,
  formData: FormData,
): Promise<ManualLeadState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const u = await currentUser();
  if (!u) return { error: "Unauthorized." };
  if (!isAgency(u.role) && !(await getWorkspaceRole(u.id, workspaceId)))
    return { error: "You don't have access to this workspace." };

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const name = [firstName, lastName].filter(Boolean).join(" ");
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const city = String(formData.get("city") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  if (!firstName || !lastName)
    return { error: "First and last name are required." };
  if (!phone && !email)
    return { error: "Add at least one way to contact the lead (phone or email)." };
  if (email && !EMAIL_RE.test(email)) return { error: "Invalid email." };

  try {
    // Same landing spot as synced leads: the first open pipeline stage.
    const [defaultStage] = await db()
      .select({ id: schema.stages.id })
      .from(schema.stages)
      .where(
        and(
          eq(schema.stages.workspaceId, workspaceId),
          eq(schema.stages.kind, "open"),
        ),
      )
      .orderBy(asc(schema.stages.position))
      .limit(1);

    const geo = city ? await geocodeCityCached(city) : null;

    const [lead] = await db()
      .insert(schema.leads)
      .values({
        workspaceId,
        platform: "manual",
        name,
        // Keep the explicit split: "Juan Pablo" + "Rivas" can't be recovered
        // from the joined name, and leadNameParts prefers these fields.
        formData: { first_name: firstName, last_name: lastName },
        phone: phone || null,
        email: email || null,
        geoCity: city || null,
        geoLat: geo ? geo.lat.toFixed(6) : null,
        geoLng: geo ? geo.lng.toFixed(6) : null,
        stageId: defaultStage?.id ?? null,
      })
      .returning({ id: schema.leads.id });

    if (note) {
      await db().insert(schema.leadEvents).values({
        leadId: lead.id,
        userId: u.id,
        type: "note",
        payload: { text: note },
      });
    }

    revalidatePath("/leads");
    revalidatePath("/leads/pipeline");
    revalidatePath("/leads/queue");
    return { success: `${name} added to the pipeline.` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
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

/**
 * Full lead detail in the Leads-table row shape — lets other surfaces
 * (e.g. the Pipeline board) open the same LeadDetailSheet on demand.
 */
export async function getLeadDetail(leadId: string): Promise<LeadRow | null> {
  const { lead } = await requireLeadAccess(leadId);
  return getLeadRowById(lead.workspaceId, leadId);
}
