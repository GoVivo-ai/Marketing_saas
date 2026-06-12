import { NextResponse } from "next/server";
import { and, asc, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getWorkspaceContext } from "@/lib/data";
import {
  generateInsights,
  isAiConfigured,
  CampaignSnapshot,
  CityPerformance,
  PlanStatus,
  FunnelStage,
  LeadQuality,
} from "@/lib/ai/insights";

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
  const { active } = await getWorkspaceContext();
  if (!active) {
    return NextResponse.json({ error: "No workspace selected" }, { status: 400 });
  }
  if (!(await isAiConfigured(active.id))) {
    return NextResponse.json(
      { error: "AI is not configured. Add the Anthropic API key in Settings → Connections." },
      { status: 503 },
    );
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

  // ── The rest of the workspace picture: cities, plan pacing, funnel, quality ──
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const now = new Date();
  const monthStart = `${dateStr(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)))}`;
  const daysInMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getDate();
  const since30 = daysAgo(30);

  const [cityRows, planRows, monthRow, stageRows, qualityRow] = await Promise.all([
    // Last-14-day spend & leads per targeted city.
    db()
      .select({
        city: schema.adsets.cityName,
        state: schema.adsets.cityRegion,
        spend: sql<string>`coalesce(sum(${schema.adsetMetricsDaily.spend}), 0)`,
        leads: sql<string>`coalesce(sum(${schema.adsetMetricsDaily.leads}), 0)`,
      })
      .from(schema.adsetMetricsDaily)
      .innerJoin(schema.adsets, eq(schema.adsetMetricsDaily.adsetId, schema.adsets.id))
      .where(
        and(
          eq(schema.adsetMetricsDaily.workspaceId, active.id),
          gte(schema.adsetMetricsDaily.date, since14),
          isNotNull(schema.adsets.cityName),
        ),
      )
      .groupBy(schema.adsets.cityName, schema.adsets.cityRegion),
    // This month's most recently updated plan (several can exist now).
    db()
      .select()
      .from(schema.monthlyPlans)
      .where(
        and(
          eq(schema.monthlyPlans.workspaceId, active.id),
          eq(schema.monthlyPlans.month, monthStart),
        ),
      )
      .orderBy(desc(schema.monthlyPlans.updatedAt))
      .limit(1),
    // Month-to-date executed spend & leads.
    db()
      .select({
        spend: sql<string>`coalesce(sum(${schema.metricsDaily.spend}), 0)`,
        leads: sql<string>`coalesce(sum(${schema.metricsDaily.leads}), 0)`,
      })
      .from(schema.metricsDaily)
      .where(
        and(
          eq(schema.metricsDaily.workspaceId, active.id),
          gte(schema.metricsDaily.date, monthStart),
        ),
      ),
    // Funnel: every stage with its current lead count.
    db()
      .select({
        stage: schema.stages.name,
        kind: schema.stages.kind,
        leads: sql<number>`count(${schema.leads.id})::int`,
      })
      .from(schema.stages)
      .leftJoin(schema.leads, eq(schema.leads.stageId, schema.stages.id))
      .where(eq(schema.stages.workspaceId, active.id))
      .groupBy(schema.stages.id, schema.stages.name, schema.stages.kind, schema.stages.position)
      .orderBy(asc(schema.stages.position)),
    // Lead quality over the last 30 days.
    db()
      .select({
        total: sql<number>`count(*)::int`,
        scored: sql<number>`count(${schema.leads.aiScore})::int`,
        avgScore: sql<string | null>`avg(${schema.leads.aiScore})`,
        inRadius: sql<number>`count(*) filter (where ${schema.leads.radiusBoost} > 0)::int`,
        geoKnown: sql<number>`count(*) filter (where ${schema.leads.geoLat} is not null and ${schema.leads.adsetId} is not null)::int`,
      })
      .from(schema.leads)
      .where(
        and(eq(schema.leads.workspaceId, active.id), gte(schema.leads.createdAt, since30)),
      ),
  ]);

  const cities: CityPerformance[] = cityRows
    .map((r) => {
      const spend = round2(Number(r.spend));
      const leads = Number(r.leads);
      return {
        city: r.city!,
        state: r.state,
        spend,
        leads,
        cpl: leads > 0 ? round2(spend / leads) : null,
      };
    })
    .filter((c) => c.spend > 0)
    .sort((a, b) => b.spend - a.spend);

  const p = planRows[0];
  const spendToDate = round2(Number(monthRow[0]?.spend ?? 0));
  const leadsToDate = Number(monthRow[0]?.leads ?? 0);
  const plan: PlanStatus | null = p
    ? {
        planName: p.name,
        month: monthStart.slice(0, 7),
        budget: Number(p.budget),
        targetCpl: Number(p.targetCpl),
        targetLeads: p.targetLeads,
        spendToDate,
        leadsToDate,
        actualCpl: leadsToDate > 0 ? round2(spendToDate / leadsToDate) : null,
        daysElapsed: now.getUTCDate(),
        daysInMonth,
      }
    : null;

  const funnel: FunnelStage[] = stageRows.map((r) => ({
    stage: r.stage,
    kind: r.kind,
    leads: Number(r.leads),
  }));

  const q = qualityRow[0];
  const leadQuality: LeadQuality | null = q
    ? {
        leadsLast30d: q.total,
        scored: q.scored,
        avgScore: q.avgScore != null ? round2(Number(q.avgScore)) : null,
        inRadius: q.inRadius,
        geoKnown: q.geoKnown,
      }
    : null;

  const insights = await generateInsights(
    active.name,
    { campaigns: snapshots, cities, plan, funnel, leadQuality },
    active.id,
  );

  await db()
    .insert(schema.aiInsights)
    .values(
      insights.map((i) => ({
        workspaceId: active.id,
        kind: i.kind,
        severity: i.severity,
        title: i.title,
        body: i.body,
        data: { action: i.action },
      })),
    );

  return NextResponse.json({ insights, source: "live" });
}
