"use server";

import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db";
import { canManageWorkspace } from "@/lib/permissions";
import { isDemoSession, DEMO_BLOCKED_MSG } from "@/lib/demo";

export interface ScoreAutomationState {
  error?: string;
  success?: string;
}

/**
 * Saves the workspace's score-based auto-contact rule (Settings → Workspace).
 * One rule per workspace, upserted on workspaceId.
 */
export async function saveScoreAutomation(
  _prev: ScoreAutomationState,
  formData: FormData,
): Promise<ScoreAutomationState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  if (!workspaceId) return { error: "Missing workspace" };
  if (!(await canManageWorkspace(workspaceId)))
    return { error: "You don't have permission to manage this workspace" };
  if (await isDemoSession()) return { error: DEMO_BLOCKED_MSG };

  const enabled = formData.get("enabled") === "on";
  const direction = formData.get("direction") === "below" ? "below" : "above";
  const threshold = Number(formData.get("threshold"));
  const action = formData.get("action") === "queue" ? "queue" : "sms";
  const message = String(formData.get("message") ?? "").trim();
  const senderUserId = String(formData.get("senderUserId") ?? "") || null;

  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100)
    return { error: "Threshold must be a number between 0 and 100" };
  if (enabled && !message)
    return { error: "Write the message to send (or the agent script)" };
  if (enabled && action === "sms" && !senderUserId)
    return { error: "Pick who the automated SMS is sent as" };

  const values = {
    enabled,
    direction,
    threshold: Math.round(threshold),
    action,
    message,
    senderUserId,
    updatedAt: new Date(),
  };
  await db()
    .insert(schema.scoreAutomations)
    .values({ workspaceId, ...values })
    .onConflictDoUpdate({
      target: schema.scoreAutomations.workspaceId,
      set: values,
    });

  revalidatePath("/settings/general");
  revalidatePath("/leads/queue");
  return { success: enabled ? "Automation saved and active." : "Automation saved (disabled)." };
}
