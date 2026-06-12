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
            "2-4 sentences of analysis. Reference concrete numbers and name the campaign/city/stage. Do NOT include the next step here.",
          ),
        action: z
          .string()
          .describe(
            "The single concrete next step, imperative and specific (e.g. 'Move ~$50/day from Redondo Beach to Paramount'). Max 120 chars.",
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

/** Per-city ad performance — the lever the team actually pulls (city lists). */
export interface CityPerformance {
  city: string;
  state: string | null;
  spend: number;
  leads: number;
  cpl: number | null;
}

/** The saved plan vs what's actually executing this month. */
export interface PlanStatus {
  planName: string;
  month: string;
  budget: number;
  targetCpl: number;
  targetLeads: number;
  spendToDate: number;
  leadsToDate: number;
  actualCpl: number | null;
  daysElapsed: number;
  daysInMonth: number;
}

export interface FunnelStage {
  stage: string;
  kind: string;
  leads: number;
}

export interface LeadQuality {
  leadsLast30d: number;
  scored: number;
  avgScore: number | null;
  /** Leads confirmed inside their ad set's audience radius. */
  inRadius: number;
  /** Leads with enough geo data to judge the radius at all. */
  geoKnown: number;
}

/** Everything the analyst sees: campaigns, cities, plan pacing, funnel, quality. */
export interface WorkspaceInsightData {
  campaigns: CampaignSnapshot[];
  cities: CityPerformance[];
  plan: PlanStatus | null;
  funnel: FunnelStage[];
  leadQuality: LeadQuality | null;
}

/**
 * Produces a small set of decision-grade insights from the full workspace
 * picture: week-over-week campaigns, per-city CPL, plan pacing, funnel
 * bottlenecks and lead quality.
 */
export async function generateInsights(
  workspaceName: string,
  data: WorkspaceInsightData,
  workspaceId?: string,
): Promise<GeneratedInsight[]> {
  const anthropic = await anthropicProvider(workspaceId);
  const { object } = await generateObject({
    model: anthropic(MODEL),
    schema: insightSchema,
    prompt: [
      `You are the senior performance-marketing analyst for the agency Vivo.`,
      `Client: ${workspaceName}. You are writing for the person who will adjust`,
      `the campaigns today — every insight must change what they do, not describe data.`,
      ``,
      `You get the full picture as JSON:`,
      `- campaigns: week-over-week spend/leads (current vs previous week)`,
      `- cities: last-14-day spend, leads and CPL per targeted city — the team`,
      `  allocates budget by city, so CPL gaps between cities are the #1 lever`,
      `- plan: this month's saved plan vs executed (budget, CPL target, pacing)`,
      `- funnel: pipeline stages with current lead counts (kind won = a sale)`,
      `- leadQuality: AI scores and how many leads fall inside the targeted radius`,
      ``,
      `Priorities, in order:`,
      `1. City budget reallocation: name the expensive city and the cheap one with`,
      `   both CPLs and say how much to shift (e.g. "move ~$50/day from X to Y").`,
      `2. Plan pacing: on track or not for budget and leads — project month-end from`,
      `   the daily run rate and say what to change if it misses.`,
      `3. Funnel bottleneck: the stage transition losing the most leads; quantify it.`,
      `4. Lead quality / radius waste: low scores or many out-of-radius leads →`,
      `   recommend tightening targeting (city lists instead of radius).`,
      ``,
      `Rules: every claim cites a number from the data; name campaigns, cities and`,
      `stages explicitly; one concrete next step per insight; skip any section with`,
      `no real signal — fewer, sharper insights beat filler. Do not invent data.`,
      ``,
      JSON.stringify(data, null, 2),
    ].join("\n"),
  });
  return object.insights;
}
