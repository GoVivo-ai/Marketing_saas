import { generateObject } from "ai";
import { z } from "zod";
import { anthropicProvider } from "./provider";

export { isAiConfigured } from "./provider";

const MODEL = "claude-sonnet-4-6";

export const insightSchema = z.object({
  insights: z
    .array(
      z.object({
        kind: z.enum(["weekly_summary", "anomaly", "recommendation", "forecast"]),
        severity: z.enum(["info", "warning", "critical"]),
        title: z.string().describe("Short, specific headline (max 80 chars)"),
        body: z
          .string()
          .describe(
            "2-4 sentences. Reference concrete numbers and name the campaign. End with one actionable next step.",
          ),
      }),
    )
    .min(1)
    .max(6),
});

export type GeneratedInsight = z.infer<typeof insightSchema>["insights"][number];

export interface CampaignSnapshot {
  campaign: string;
  platform: string;
  thisWeek: { spend: number; impressions: number; clicks: number; leads: number };
  lastWeek: { spend: number; impressions: number; clicks: number; leads: number };
}

/**
 * Analyzes week-over-week campaign performance and produces a small set of
 * high-signal insights: anomalies, budget recommendations and a summary.
 */
export async function generateInsights(
  workspaceName: string,
  snapshots: CampaignSnapshot[],
  workspaceId?: string,
): Promise<GeneratedInsight[]> {
  const anthropic = await anthropicProvider(workspaceId);
  const { object } = await generateObject({
    model: anthropic(MODEL),
    schema: insightSchema,
    prompt: [
      `You are the senior performance-marketing analyst for the agency Vivo.`,
      `Client: ${workspaceName}.`,
      `Below is week-over-week campaign data (current week vs previous week), as JSON.`,
      `Detect what truly matters: cost-per-lead shifts, spend anomalies, scaling`,
      `opportunities and underperformers. Be concrete and quantitative — every`,
      `claim must cite a number from the data. Do not invent data.`,
      ``,
      JSON.stringify(snapshots, null, 2),
    ].join("\n"),
  });
  return object.insights;
}
