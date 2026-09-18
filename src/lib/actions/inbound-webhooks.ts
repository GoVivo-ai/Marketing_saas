"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db";
import { canManageWorkspace } from "@/lib/permissions";
import { isDemoSession, DEMO_BLOCKED_MSG } from "@/lib/demo";
import { newWebhookToken } from "@/lib/inbound-leads";

export interface InboundWebhookState {
  error?: string;
  success?: string;
}

async function gate(workspaceId: string): Promise<string | null> {
  if (!workspaceId) return "No workspace selected.";
  if (await isDemoSession()) return DEMO_BLOCKED_MSG;
  if (!(await canManageWorkspace(workspaceId)))
    return "Only your organization's admins can manage this.";
  return null;
}

/** Creates the workspace's webhook URL, or mints a new token to retire the old URL. */
export async function generateInboundWebhook(
  _prev: InboundWebhookState,
  formData: FormData,
): Promise<InboundWebhookState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const denied = await gate(workspaceId);
  if (denied) return { error: denied };

  const token = newWebhookToken();
  await db()
    .insert(schema.inboundWebhooks)
    .values({ workspaceId, token })
    .onConflictDoUpdate({
      target: schema.inboundWebhooks.workspaceId,
      set: { token, updatedAt: new Date() },
    });
  revalidatePath("/settings");
  return { success: "Webhook URL ready — paste it into the tool that sends leads." };
}

/** Sets or clears the Slack channel that hears about each new lead. */
export async function saveInboundSlack(
  _prev: InboundWebhookState,
  formData: FormData,
): Promise<InboundWebhookState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const denied = await gate(workspaceId);
  if (denied) return { error: denied };

  const url = String(formData.get("slackWebhookUrl") ?? "").trim();
  if (url && !/^https:\/\/hooks\.slack\.com\/services\//.test(url))
    return { error: "That doesn't look like a Slack incoming webhook URL (https://hooks.slack.com/services/…)." };

  const res = await db()
    .update(schema.inboundWebhooks)
    .set({ slackWebhookUrl: url || null, updatedAt: new Date() })
    .where(eq(schema.inboundWebhooks.workspaceId, workspaceId))
    .returning({ id: schema.inboundWebhooks.id });
  if (!res.length) return { error: "Generate the webhook URL first." };
  revalidatePath("/settings");
  return { success: url ? "Slack notifications on." : "Slack notifications off." };
}

/** Removes the webhook; the URL stops working immediately. */
export async function deleteInboundWebhook(formData: FormData): Promise<void> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const denied = await gate(workspaceId);
  if (denied) throw new Error(denied);
  await db()
    .delete(schema.inboundWebhooks)
    .where(eq(schema.inboundWebhooks.workspaceId, workspaceId));
  revalidatePath("/settings");
}
