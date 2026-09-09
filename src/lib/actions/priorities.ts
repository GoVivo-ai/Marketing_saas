"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { auth } from "@/lib/auth";
import { canManageWorkspace } from "@/lib/permissions";
import { isDemoSession, DEMO_BLOCKED_MSG } from "@/lib/demo";
import {
  applyContactPriority,
  type ApplyPriorityResult,
} from "@/lib/ai/contact-priority";

export type PriorityResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export interface PriorityInput {
  name: string;
  prompt: string;
  campaignId: string | null;
  regions: string[];
  sinceDays: number | null;
  agentId: string | null;
}

const PATHS = ["/leads/queue", "/leads/queue/scoring"];
const revalidate = () => PATHS.forEach((p) => revalidatePath(p));

async function authorize(workspaceId: string): Promise<string | null> {
  if (!(await canManageWorkspace(workspaceId))) return "You don't have permission to manage this workspace";
  if (await isDemoSession()) return DEMO_BLOCKED_MSG;
  return null;
}

function clean(input: PriorityInput): PriorityInput | string {
  const name = input.name.trim();
  const prompt = input.prompt.trim();
  if (!name) return "Give the priority a name";
  if (!prompt) return "Describe what to prioritize";
  if (prompt.length > 2000) return "Keep the priority under 2000 characters";
  const sinceDays =
    input.sinceDays && input.sinceDays > 0 ? Math.min(365, Math.round(input.sinceDays)) : null;
  return {
    name,
    prompt,
    campaignId: input.campaignId || null,
    regions: input.regions.map((r) => r.trim()).filter(Boolean),
    sinceDays,
    agentId: input.agentId || null,
  };
}

/** Creates a priority (inactive boosts until it's applied). */
export async function createContactPriority(
  workspaceId: string,
  input: PriorityInput,
): Promise<PriorityResult> {
  const denied = await authorize(workspaceId);
  if (denied) return { ok: false, error: denied };
  const v = clean(input);
  if (typeof v === "string") return { ok: false, error: v };
  const session = await auth();
  const [row] = await db()
    .insert(schema.contactPriorities)
    .values({
      workspaceId,
      name: v.name,
      prompt: v.prompt,
      campaignId: v.campaignId,
      regions: v.regions.length ? v.regions : null,
      sinceDays: v.sinceDays,
      agentId: v.agentId,
      createdById: session?.user?.id ?? null,
    })
    .returning({ id: schema.contactPriorities.id });
  revalidate();
  return { ok: true, id: row.id };
}

export async function updateContactPriority(
  workspaceId: string,
  priorityId: string,
  input: PriorityInput,
): Promise<PriorityResult> {
  const denied = await authorize(workspaceId);
  if (denied) return { ok: false, error: denied };
  const v = clean(input);
  if (typeof v === "string") return { ok: false, error: v };
  await db()
    .update(schema.contactPriorities)
    .set({
      name: v.name,
      prompt: v.prompt,
      campaignId: v.campaignId,
      regions: v.regions.length ? v.regions : null,
      sinceDays: v.sinceDays,
      agentId: v.agentId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.contactPriorities.id, priorityId),
        eq(schema.contactPriorities.workspaceId, workspaceId),
      ),
    );
  revalidate();
  return { ok: true, id: priorityId };
}

/** Pauses/resumes a priority — its boosts stay stored, just not applied. */
export async function setContactPriorityActive(
  workspaceId: string,
  priorityId: string,
  active: boolean,
): Promise<PriorityResult> {
  const denied = await authorize(workspaceId);
  if (denied) return { ok: false, error: denied };
  await db()
    .update(schema.contactPriorities)
    .set({ active, updatedAt: new Date() })
    .where(
      and(
        eq(schema.contactPriorities.id, priorityId),
        eq(schema.contactPriorities.workspaceId, workspaceId),
      ),
    );
  revalidate();
  return { ok: true, id: priorityId };
}

export async function deleteContactPriority(
  workspaceId: string,
  priorityId: string,
): Promise<PriorityResult> {
  const denied = await authorize(workspaceId);
  if (denied) return { ok: false, error: denied };
  await db()
    .delete(schema.contactPriorities)
    .where(
      and(
        eq(schema.contactPriorities.id, priorityId),
        eq(schema.contactPriorities.workspaceId, workspaceId),
      ),
    );
  revalidate();
  return { ok: true, id: priorityId };
}

/**
 * Computes the boosts for a priority's audience with the AI. Explicit and
 * operator-triggered — this is the only place a priority spends AI credits.
 */
export async function applyContactPriorityAction(
  workspaceId: string,
  priorityId: string,
): Promise<ApplyPriorityResult> {
  const denied = await authorize(workspaceId);
  if (denied) return { ok: false, audience: 0, applied: 0, matched: 0, error: denied };
  const [p] = await db()
    .select({ id: schema.contactPriorities.id })
    .from(schema.contactPriorities)
    .where(
      and(
        eq(schema.contactPriorities.id, priorityId),
        eq(schema.contactPriorities.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!p) return { ok: false, audience: 0, applied: 0, matched: 0, error: "Priority not found." };
  const res = await applyContactPriority(priorityId);
  revalidate();
  return res;
}
