"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { canManageWorkspace } from "@/lib/permissions";
import { rescoreCampaignLeads, summarizeCriteria } from "@/lib/ai/lead-scoring";

export interface CampaignScoringState {
  error?: string;
  success?: string;
}

/** Confirms the campaign belongs to a workspace the caller can manage. */
async function authorizeCampaign(
  campaignId: string,
): Promise<{ workspaceId: string } | null> {
  const [campaign] = await db()
    .select({ workspaceId: schema.campaigns.workspaceId })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, campaignId))
    .limit(1);
  if (!campaign) return null;
  if (!(await canManageWorkspace(campaign.workspaceId))) return null;
  return { workspaceId: campaign.workspaceId };
}

/**
 * Saves the per-campaign AI lead-scoring criteria (the prompt). Does NOT
 * re-score existing leads — that is a separate, explicit action so editing the
 * prompt never triggers surprise AI spend. New leads from this campaign are
 * scored with the saved criteria at sync time.
 */
export async function saveCampaignScoringCriteria(
  _prev: CampaignScoringState,
  formData: FormData,
): Promise<CampaignScoringState> {
  const campaignId = String(formData.get("campaignId") ?? "");
  const auth = await authorizeCampaign(campaignId);
  if (!auth)
    return { error: "You don't have permission to edit this campaign." };

  const scoringCriteria =
    String(formData.get("scoringCriteria") ?? "").trim() || null;

  // Agent-facing digest of the prompt, shown in the Contact Queue. Nullable —
  // when AI is unavailable the queue falls back to the full criteria text.
  const scoringCriteriaSummary = scoringCriteria
    ? await summarizeCriteria(auth.workspaceId, scoringCriteria)
    : null;

  await db()
    .update(schema.campaigns)
    .set({ scoringCriteria, scoringCriteriaSummary })
    .where(
      and(
        eq(schema.campaigns.id, campaignId),
        eq(schema.campaigns.workspaceId, auth.workspaceId),
      ),
    );

  revalidatePath(`/campaigns/${campaignId}`);
  return {
    success: scoringCriteria
      ? "Scoring criteria saved. Re-score existing leads to apply it to them."
      : "Scoring criteria cleared — this campaign now uses the workspace criteria.",
  };
}

/**
 * Re-scores every existing lead of this campaign with its current criteria.
 * Explicit, operator-triggered — this is where the AI spend happens.
 */
export async function rescoreCampaign(
  _prev: CampaignScoringState,
  formData: FormData,
): Promise<CampaignScoringState> {
  const campaignId = String(formData.get("campaignId") ?? "");
  const auth = await authorizeCampaign(campaignId);
  if (!auth)
    return { error: "You don't have permission to edit this campaign." };

  const { scored, total } = await rescoreCampaignLeads(auth.workspaceId, campaignId);

  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/leads");
  if (total === 0) return { success: "No leads to re-score for this campaign." };
  return {
    success: `Re-scored ${scored} of ${total} lead${total === 1 ? "" : "s"}.`,
  };
}
