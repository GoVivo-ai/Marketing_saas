import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateInsights, isAiConfigured, CampaignSnapshot } from "@/lib/ai/insights";
import { demoCampaigns, demoInsights } from "@/lib/demo-data";

/**
 * Generates fresh AI insights for the current workspace.
 * Falls back to curated demo insights when ANTHROPIC_API_KEY is absent,
 * so the product demo never shows an empty state.
 */
export async function POST() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAiConfigured()) {
    return NextResponse.json({ insights: demoInsights, source: "demo" });
  }

  // TODO(victor): replace demo snapshots with a metricsDaily aggregation
  // per workspace once live sync is running.
  const snapshots: CampaignSnapshot[] = demoCampaigns
    .filter((c) => c.spend > 0)
    .map((c) => ({
      campaign: c.name,
      platform: c.platform,
      thisWeek: { spend: c.spend, impressions: c.impressions, clicks: c.clicks, leads: c.leads },
      lastWeek: {
        spend: Math.round(c.spend * 1.04 * 100) / 100,
        impressions: Math.round(c.impressions * 0.97),
        clicks: Math.round(c.clicks * 0.95),
        leads: Math.round(c.leads * 0.92),
      },
    }));

  const insights = await generateInsights("Alexia Transport", snapshots);
  return NextResponse.json({ insights, source: "live" });
}
