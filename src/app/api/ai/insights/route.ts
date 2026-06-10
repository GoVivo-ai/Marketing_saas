import { NextResponse } from "next/server";
import { and, eq, gte } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getWorkspaceContext } from "@/lib/data";
import { generateInsights, isAiConfigured, CampaignSnapshot } from "@/lib/ai/insights";

export const maxDuration = 60;

const dateStr = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
};

/**
 * Generates fresh AI insights for the active workspace from the last 14 days
 * of synced metrics (current week vs previous week) and persists them.
 */
export async function POST() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isAiConfigured())) {
    return NextResponse.json(
      { error: "AI is not configured. Add the Anthropic API key in Settings → Connections." },
      { status: 503 },
    );
  }

  const { active } = await getWorkspaceContext();
  if (!active) {
    return NextResponse.json({ error: "No workspace selected" }, { status: 400 });
  }

  const since14 = dateStr(daysAgo(14));
  const since7 = dateStr(daysAgo(7));

  const [rows, campaigns] = await Promise.all([
    db()
      .select({
        campaignId: schema.metricsDaily.campaignId,
        date: schema.metricsDaily.date,
        spend: schema.metricsDaily.spend,
        impressions: schema.metricsDaily.impressions,
        clicks: schema.metricsDaily.clicks,
        leads: schema.metricsDaily.leads,
      })
      .from(schema.metricsDaily)
      .where(
        and(
          eq(schema.metricsDaily.workspaceId, active.id),
          gte(schema.metricsDaily.date, since14),
        ),
      ),
    db()
      .select({
        id: schema.campaigns.id,
        name: schema.campaigns.name,
        platform: schema.campaigns.platform,
      })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.workspaceId, active.id)),
  ]);

  const nameById = new Map(campaigns.map((c) => [c.id, c]));
  const snapshots: CampaignSnapshot[] = [];
  for (const campaign of campaigns) {
    const mine = rows.filter((r) => r.campaignId === campaign.id);
    if (!mine.length) continue;
    const totals = (set: typeof mine) =>
      set.reduce(
        (acc, r) => ({
          spend: acc.spend + Number(r.spend),
          impressions: acc.impressions + r.impressions,
          clicks: acc.clicks + r.clicks,
          leads: acc.leads + r.leads,
        }),
        { spend: 0, impressions: 0, clicks: 0, leads: 0 },
      );
    const thisWeek = totals(mine.filter((r) => r.date >= since7));
    const lastWeek = totals(mine.filter((r) => r.date < since7));
    if (thisWeek.spend === 0 && lastWeek.spend === 0) continue;
    snapshots.push({
      campaign: nameById.get(campaign.id)?.name ?? campaign.id,
      platform: campaign.platform,
      thisWeek,
      lastWeek,
    });
  }

  if (!snapshots.length) {
    return NextResponse.json({
      insights: [],
      message: "No campaign activity in the last 14 days to analyze.",
    });
  }

  const insights = await generateInsights(active.name, snapshots);

  await db()
    .insert(schema.aiInsights)
    .values(
      insights.map((i) => ({
        workspaceId: active.id,
        kind: i.kind,
        severity: i.severity,
        title: i.title,
        body: i.body,
      })),
    );

  return NextResponse.json({ insights, source: "live" });
}
