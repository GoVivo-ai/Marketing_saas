import { cookies } from "next/headers";
import { and, desc, eq, gte } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema, isDatabaseConfigured } from "@/lib/db";

/**
 * Read-side data layer for the product pages. Every function is scoped to
 * one workspace.
 */

export interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
  accentColor: string | null;
}

export interface Kpi {
  value: number;
  deltaPct: number;
}

export interface OverviewData {
  kpis: { spend: Kpi; leads: Kpi; cpl: Kpi; ctr: Kpi };
  series: { date: string; spend: number; leads: number }[];
  topCampaigns: {
    id: string;
    name: string;
    platform: string;
    objective: string | null;
    status: string;
    spend: number;
    leads: number;
    cpl: number;
  }[];
  insights: { kind: string; severity: string; title: string; body: string }[];
  lastSyncedAt: Date | null;
}

export interface CampaignRow {
  id: string;
  name: string;
  platform: string;
  status: string;
  objective: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  cpl: number;
  trend: number;
}

export interface LeadRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  campaign: string;
  status: string;
  aiScore: number | null;
  aiReason: string | null;
  createdAt: Date;
}

const dateStr = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
};
const deltaPct = (current: number, previous: number) =>
  previous > 0 ? ((current - previous) / previous) * 100 : current > 0 ? 100 : 0;

// ─────────────────────────────────────────────────────────────────────────
// Workspace context
// ─────────────────────────────────────────────────────────────────────────

export async function getWorkspaceContext(): Promise<{
  workspaces: WorkspaceInfo[];
  active: WorkspaceInfo | null;
}> {
  const requested = (await cookies()).get("ws")?.value;

  if (!isDatabaseConfigured()) {
    return { workspaces: [], active: null };
  }

  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role ?? "client";
  const userId = session?.user?.id;

  let workspaces: WorkspaceInfo[];
  if (role === "client") {
    workspaces = userId
      ? await db()
          .select({
            id: schema.workspaces.id,
            name: schema.workspaces.name,
            slug: schema.workspaces.slug,
            accentColor: schema.workspaces.accentColor,
          })
          .from(schema.workspaces)
          .innerJoin(
            schema.workspaceMembers,
            eq(schema.workspaceMembers.workspaceId, schema.workspaces.id),
          )
          .where(eq(schema.workspaceMembers.userId, userId))
      : [];
  } else {
    workspaces = await db()
      .select({
        id: schema.workspaces.id,
        name: schema.workspaces.name,
        slug: schema.workspaces.slug,
        accentColor: schema.workspaces.accentColor,
      })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.isActive, true));
  }

  let active = workspaces.find((w) => w.slug === requested) ?? null;

  // No explicit selection yet: default to the first workspace that actually
  // has an active platform connection, so a fresh login lands on real data.
  if (!active && workspaces.length) {
    const activeConnections = await db()
      .select({ workspaceId: schema.connections.workspaceId })
      .from(schema.connections)
      .where(eq(schema.connections.status, "active"));
    const connected = new Set(activeConnections.map((c) => c.workspaceId));
    active = workspaces.find((w) => connected.has(w.id)) ?? workspaces[0];
  }

  return { workspaces, active };
}

// ─────────────────────────────────────────────────────────────────────────
// Overview (last 30 days, deltas vs the 30 days before)
// ─────────────────────────────────────────────────────────────────────────

export async function getOverview(workspaceId: string): Promise<OverviewData> {
  const since60 = dateStr(daysAgo(60));
  const since30 = dateStr(daysAgo(30));

  const rows = await db()
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
        eq(schema.metricsDaily.workspaceId, workspaceId),
        gte(schema.metricsDaily.date, since60),
      ),
    );

  const current = rows.filter((r) => r.date >= since30);
  const previous = rows.filter((r) => r.date < since30);

  const totals = (set: typeof rows) =>
    set.reduce(
      (acc, r) => ({
        spend: acc.spend + Number(r.spend),
        impressions: acc.impressions + r.impressions,
        clicks: acc.clicks + r.clicks,
        leads: acc.leads + r.leads,
      }),
      { spend: 0, impressions: 0, clicks: 0, leads: 0 },
    );

  const cur = totals(current);
  const prev = totals(previous);
  const cpl = (t: typeof cur) => (t.leads > 0 ? t.spend / t.leads : 0);
  const ctr = (t: typeof cur) => (t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0);

  const byDate = new Map<string, { spend: number; leads: number }>();
  for (const r of current) {
    const entry = byDate.get(r.date) ?? { spend: 0, leads: 0 };
    entry.spend += Number(r.spend);
    entry.leads += r.leads;
    byDate.set(r.date, entry);
  }
  const series = [...byDate.entries()]
    .map(([date, v]) => ({ date, spend: Math.round(v.spend * 100) / 100, leads: v.leads }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const byCampaign = new Map<string, { spend: number; leads: number }>();
  for (const r of current) {
    const entry = byCampaign.get(r.campaignId) ?? { spend: 0, leads: 0 };
    entry.spend += Number(r.spend);
    entry.leads += r.leads;
    byCampaign.set(r.campaignId, entry);
  }
  const campaignMeta = byCampaign.size
    ? await db()
        .select({
          id: schema.campaigns.id,
          name: schema.campaigns.name,
          platform: schema.campaigns.platform,
          objective: schema.campaigns.objective,
          status: schema.campaigns.status,
        })
        .from(schema.campaigns)
        .where(eq(schema.campaigns.workspaceId, workspaceId))
    : [];
  const topCampaigns = campaignMeta
    .map((c) => {
      const m = byCampaign.get(c.id) ?? { spend: 0, leads: 0 };
      return {
        id: c.id,
        name: c.name,
        platform: c.platform,
        objective: c.objective,
        status: c.status,
        spend: Math.round(m.spend * 100) / 100,
        leads: m.leads,
        cpl: m.leads > 0 ? Math.round((m.spend / m.leads) * 100) / 100 : 0,
      };
    })
    .filter((c) => c.spend > 0)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 4);

  const insights = await db()
    .select({
      kind: schema.aiInsights.kind,
      severity: schema.aiInsights.severity,
      title: schema.aiInsights.title,
      body: schema.aiInsights.body,
    })
    .from(schema.aiInsights)
    .where(eq(schema.aiInsights.workspaceId, workspaceId))
    .orderBy(desc(schema.aiInsights.createdAt))
    .limit(3);

  const [latestSync] = await db()
    .select({ lastSyncedAt: schema.connections.lastSyncedAt })
    .from(schema.connections)
    .where(eq(schema.connections.workspaceId, workspaceId))
    .orderBy(desc(schema.connections.lastSyncedAt))
    .limit(1);

  return {
    kpis: {
      spend: { value: cur.spend, deltaPct: deltaPct(cur.spend, prev.spend) },
      leads: { value: cur.leads, deltaPct: deltaPct(cur.leads, prev.leads) },
      cpl: { value: cpl(cur), deltaPct: deltaPct(cpl(cur), cpl(prev)) },
      ctr: { value: ctr(cur), deltaPct: deltaPct(ctr(cur), ctr(prev)) },
    },
    series,
    topCampaigns,
    insights,
    lastSyncedAt: latestSync?.lastSyncedAt ?? null,
  };
}

/** Empty view-model for sessions without a selectable workspace. */
export function getEmptyOverview(): OverviewData {
  const zero = { value: 0, deltaPct: 0 };
  return {
    kpis: { spend: zero, leads: zero, cpl: zero, ctr: zero },
    series: [],
    topCampaigns: [],
    insights: [],
    lastSyncedAt: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Campaigns (last 30 days; trend = CPL last 15d vs previous 15d)
// ─────────────────────────────────────────────────────────────────────────

export async function getCampaignRows(workspaceId: string): Promise<CampaignRow[]> {
  const since30 = dateStr(daysAgo(30));
  const since15 = dateStr(daysAgo(15));

  const [campaigns, rows] = await Promise.all([
    db()
      .select({
        id: schema.campaigns.id,
        name: schema.campaigns.name,
        platform: schema.campaigns.platform,
        status: schema.campaigns.status,
        objective: schema.campaigns.objective,
      })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.workspaceId, workspaceId)),
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
          eq(schema.metricsDaily.workspaceId, workspaceId),
          gte(schema.metricsDaily.date, since30),
        ),
      ),
  ]);

  return campaigns
    .map((c) => {
      const mine = rows.filter((r) => r.campaignId === c.id);
      const sum = mine.reduce(
        (acc, r) => ({
          spend: acc.spend + Number(r.spend),
          impressions: acc.impressions + r.impressions,
          clicks: acc.clicks + r.clicks,
          leads: acc.leads + r.leads,
        }),
        { spend: 0, impressions: 0, clicks: 0, leads: 0 },
      );
      const recent = mine.filter((r) => r.date >= since15);
      const older = mine.filter((r) => r.date < since15);
      const cplOf = (set: typeof mine) => {
        const s = set.reduce((a, r) => a + Number(r.spend), 0);
        const l = set.reduce((a, r) => a + r.leads, 0);
        return l > 0 ? s / l : 0;
      };
      const cplRecent = cplOf(recent);
      const cplOlder = cplOf(older);
      return {
        id: c.id,
        name: c.name,
        platform: c.platform,
        status: c.status,
        objective: c.objective,
        spend: Math.round(sum.spend * 100) / 100,
        impressions: sum.impressions,
        clicks: sum.clicks,
        leads: sum.leads,
        cpl: sum.leads > 0 ? Math.round((sum.spend / sum.leads) * 100) / 100 : 0,
        trend:
          cplRecent > 0 && cplOlder > 0
            ? Math.round(deltaPct(cplRecent, cplOlder) * 10) / 10
            : 0,
      };
    })
    .sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name));
}


// ─────────────────────────────────────────────────────────────────────────
// Leads
// ─────────────────────────────────────────────────────────────────────────

export async function getLeadRows(workspaceId: string, limit = 200): Promise<LeadRow[]> {
  const rows = await db()
    .select({
      id: schema.leads.id,
      name: schema.leads.name,
      email: schema.leads.email,
      phone: schema.leads.phone,
      status: schema.leads.status,
      aiScore: schema.leads.aiScore,
      aiReason: schema.leads.aiScoreReason,
      createdAt: schema.leads.createdAt,
      campaign: schema.campaigns.name,
    })
    .from(schema.leads)
    .leftJoin(schema.campaigns, eq(schema.leads.campaignId, schema.campaigns.id))
    .where(eq(schema.leads.workspaceId, workspaceId))
    .orderBy(desc(schema.leads.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    name: r.name ?? "Unknown",
    email: r.email ?? "—",
    phone: r.phone ?? "—",
    campaign: r.campaign ?? "—",
    status: r.status,
    aiScore: r.aiScore,
    aiReason: r.aiReason,
    createdAt: r.createdAt,
  }));
}

