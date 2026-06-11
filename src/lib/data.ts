import { cookies } from "next/headers";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
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
  /** Has at least one active platform connection. */
  connected: boolean;
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

/** A campaign's header info for its detail page. */
export interface CampaignDetail {
  id: string;
  name: string;
  platform: string;
  status: string;
  objective: string | null;
}

/** One ad set with 30-day metrics and its audience-location geometry. */
export interface AdSetRow {
  id: string;
  name: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  cpl: number;
  city: string | null;
  region: string | null;
  country: string | null;
  radius: number | null;
  distanceUnit: string | null;
  lat: number | null;
  lng: number | null;
}

export interface LeadRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  campaign: string;
  platform: string;
  externalId: string | null;
  status: string;
  stageId: string | null;
  stageName: string | null;
  stageColor: string | null;
  aiScore: number | null;
  aiReason: string | null;
  aiSuggestedAction: string | null;
  formData: Record<string, unknown> | null;
  assignedTo: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const dateStr = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => daysBefore(new Date(), n);
const daysBefore = (from: Date, n: number) => {
  const d = new Date(from);
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

  let rows: Omit<WorkspaceInfo, "connected">[];
  if (role === "client") {
    rows = userId
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
    rows = await db()
      .select({
        id: schema.workspaces.id,
        name: schema.workspaces.name,
        slug: schema.workspaces.slug,
        accentColor: schema.workspaces.accentColor,
      })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.isActive, true));
  }

  const activeConnections = await db()
    .select({ workspaceId: schema.connections.workspaceId })
    .from(schema.connections)
    .where(eq(schema.connections.status, "active"));
  const connectedIds = new Set(activeConnections.map((c) => c.workspaceId));

  // Connected workspaces first, then alphabetical.
  const workspaces: WorkspaceInfo[] = rows
    .map((w) => ({ ...w, connected: connectedIds.has(w.id) }))
    .sort(
      (a, b) =>
        Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name),
    );

  // Explicit selection wins; otherwise default to the first connected
  // workspace so a fresh login lands on real data.
  const active =
    workspaces.find((w) => w.slug === requested) ?? workspaces[0] ?? null;

  return { workspaces, active };
}

// ─────────────────────────────────────────────────────────────────────────
// Overview (last 30 days, deltas vs the 30 days before)
// ─────────────────────────────────────────────────────────────────────────

export async function getOverview(
  workspaceId: string,
  range: { start: Date; end: Date },
): Promise<OverviewData> {
  // Current window is [start, end]; the delta compares against the
  // equal-length window immediately before it.
  const startStr = dateStr(range.start);
  const endStr = dateStr(range.end);
  const lengthDays = Math.max(
    1,
    Math.round((Date.parse(endStr) - Date.parse(startStr)) / 86_400_000) + 1,
  );
  const prevStartStr = dateStr(daysBefore(range.start, lengthDays));

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
        gte(schema.metricsDaily.date, prevStartStr),
        lte(schema.metricsDaily.date, endStr),
      ),
    );

  const current = rows.filter((r) => r.date >= startStr && r.date <= endStr);
  const previous = rows.filter((r) => r.date < startStr);

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

export async function getCampaignRows(
  workspaceId: string,
  range: { start: Date; end: Date },
): Promise<CampaignRow[]> {
  const startStr = dateStr(range.start);
  const endStr = dateStr(range.end);
  // Split the window in half so "trend" compares CPL in the recent half vs the
  // earlier half — the same idea as the 15-vs-15 split, generalized to any range.
  const midStr = dateStr(
    new Date((range.start.getTime() + range.end.getTime()) / 2),
  );

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
          gte(schema.metricsDaily.date, startStr),
          lte(schema.metricsDaily.date, endStr),
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
      const recent = mine.filter((r) => r.date >= midStr);
      const older = mine.filter((r) => r.date < midStr);
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
// Campaign detail → ad sets (one ad set per targeted city)
// ─────────────────────────────────────────────────────────────────────────

/** Campaign header, scoped to the workspace (null if it isn't theirs). */
export async function getCampaignById(
  workspaceId: string,
  campaignId: string,
): Promise<CampaignDetail | null> {
  const [c] = await db()
    .select({
      id: schema.campaigns.id,
      name: schema.campaigns.name,
      platform: schema.campaigns.platform,
      status: schema.campaigns.status,
      objective: schema.campaigns.objective,
    })
    .from(schema.campaigns)
    .where(
      and(
        eq(schema.campaigns.id, campaignId),
        eq(schema.campaigns.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return c ?? null;
}

/** Ad sets of a campaign with metrics over a range + audience-location geometry. */
export async function getAdSetRows(
  workspaceId: string,
  campaignId: string,
  range: { start: Date; end: Date },
): Promise<AdSetRow[]> {
  const startStr = dateStr(range.start);
  const endStr = dateStr(range.end);

  const [adsets, rows] = await Promise.all([
    db()
      .select({
        id: schema.adsets.id,
        name: schema.adsets.name,
        status: schema.adsets.status,
        city: schema.adsets.cityName,
        region: schema.adsets.cityRegion,
        country: schema.adsets.cityCountry,
        radius: schema.adsets.radius,
        distanceUnit: schema.adsets.distanceUnit,
        lat: schema.adsets.lat,
        lng: schema.adsets.lng,
      })
      .from(schema.adsets)
      .where(
        and(
          eq(schema.adsets.workspaceId, workspaceId),
          eq(schema.adsets.campaignId, campaignId),
        ),
      ),
    db()
      .select({
        adsetId: schema.adsetMetricsDaily.adsetId,
        spend: schema.adsetMetricsDaily.spend,
        impressions: schema.adsetMetricsDaily.impressions,
        clicks: schema.adsetMetricsDaily.clicks,
        leads: schema.adsetMetricsDaily.leads,
      })
      .from(schema.adsetMetricsDaily)
      .where(
        and(
          eq(schema.adsetMetricsDaily.workspaceId, workspaceId),
          gte(schema.adsetMetricsDaily.date, startStr),
          lte(schema.adsetMetricsDaily.date, endStr),
        ),
      ),
  ]);

  return adsets
    .map((a) => {
      const mine = rows.filter((r) => r.adsetId === a.id);
      const sum = mine.reduce(
        (acc, r) => ({
          spend: acc.spend + Number(r.spend),
          impressions: acc.impressions + r.impressions,
          clicks: acc.clicks + r.clicks,
          leads: acc.leads + r.leads,
        }),
        { spend: 0, impressions: 0, clicks: 0, leads: 0 },
      );
      return {
        id: a.id,
        name: a.name,
        status: a.status,
        spend: Math.round(sum.spend * 100) / 100,
        impressions: sum.impressions,
        clicks: sum.clicks,
        leads: sum.leads,
        cpl: sum.leads > 0 ? Math.round((sum.spend / sum.leads) * 100) / 100 : 0,
        city: a.city,
        region: a.region,
        country: a.country,
        radius: a.radius != null ? Number(a.radius) : null,
        distanceUnit: a.distanceUnit,
        lat: a.lat != null ? Number(a.lat) : null,
        lng: a.lng != null ? Number(a.lng) : null,
      };
    })
    .sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name));
}

// ─────────────────────────────────────────────────────────────────────────
// Leads
// ─────────────────────────────────────────────────────────────────────────

export interface LeadsPage {
  rows: LeadRow[];
  total: number;
  /** Effective (clamped) page that was actually returned. */
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function getLeadsPage(
  workspaceId: string,
  opts: {
    start?: Date | null;
    end?: Date | null;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<LeadsPage> {
  const { start, end, pageSize = 25 } = opts;
  // start/end null or omitted → unbounded on that side (all time when both).
  // Filtered against the lead's createdAt timestamp.
  const filters = [eq(schema.leads.workspaceId, workspaceId)];
  if (start) filters.push(gte(schema.leads.createdAt, start));
  if (end) filters.push(lte(schema.leads.createdAt, end));
  const where = and(...filters);

  const [{ total }] = await db()
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.leads)
    .where(where);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, opts.page ?? 1), totalPages);

  const rows = await db()
    .select({
      id: schema.leads.id,
      name: schema.leads.name,
      email: schema.leads.email,
      phone: schema.leads.phone,
      status: schema.leads.status,
      aiScore: schema.leads.aiScore,
      aiReason: schema.leads.aiScoreReason,
      aiSuggestedAction: schema.leads.aiSuggestedAction,
      formData: schema.leads.formData,
      platform: schema.leads.platform,
      externalId: schema.leads.externalId,
      createdAt: schema.leads.createdAt,
      updatedAt: schema.leads.updatedAt,
      campaign: schema.campaigns.name,
      assignedTo: schema.users.name,
      stageId: schema.leads.stageId,
      stageName: schema.stages.name,
      stageColor: schema.stages.color,
    })
    .from(schema.leads)
    .leftJoin(schema.campaigns, eq(schema.leads.campaignId, schema.campaigns.id))
    .leftJoin(schema.users, eq(schema.leads.assignedToId, schema.users.id))
    .leftJoin(schema.stages, eq(schema.leads.stageId, schema.stages.id))
    .where(where)
    .orderBy(desc(schema.leads.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const mapped = rows.map((r) => ({
    id: r.id,
    name: r.name ?? "Unknown",
    email: r.email ?? "—",
    phone: r.phone ?? "—",
    campaign: r.campaign ?? "—",
    platform: r.platform,
    externalId: r.externalId,
    status: r.status,
    stageId: r.stageId,
    stageName: r.stageName,
    stageColor: r.stageColor,
    aiScore: r.aiScore,
    aiReason: r.aiReason,
    aiSuggestedAction: r.aiSuggestedAction,
    formData: (r.formData ?? null) as Record<string, unknown> | null,
    assignedTo: r.assignedTo,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));

  return { rows: mapped, total, page, pageSize, totalPages };
}

// ─────────────────────────────────────────────────────────────────────────
// Pipeline (Kanban) — stages + leads grouped by stage
// ─────────────────────────────────────────────────────────────────────────

export interface Stage {
  id: string;
  name: string;
  color: string | null;
  kind: string;
  position: number;
}

export interface PipelineCard {
  id: string;
  name: string;
  campaign: string;
  platform: string;
  phone: string;
  aiScore: number | null;
  stageId: string | null;
  createdAt: Date;
}

export interface PipelineData {
  stages: Stage[];
  cardsByStage: Record<string, PipelineCard[]>;
  counts: Record<string, number>;
  cap: number;
}

/** Columns load at most this many cards; the header shows the true total. */
export const PIPELINE_CARD_CAP = 100;

export async function getPipeline(workspaceId: string): Promise<PipelineData> {
  const stages = await db()
    .select({
      id: schema.stages.id,
      name: schema.stages.name,
      color: schema.stages.color,
      kind: schema.stages.kind,
      position: schema.stages.position,
    })
    .from(schema.stages)
    .where(eq(schema.stages.workspaceId, workspaceId))
    .orderBy(asc(schema.stages.position));

  const countRows = await db()
    .select({
      stageId: schema.leads.stageId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.leads)
    .where(eq(schema.leads.workspaceId, workspaceId))
    .groupBy(schema.leads.stageId);
  const counts: Record<string, number> = {};
  for (const r of countRows) if (r.stageId) counts[r.stageId] = r.count;

  const cardsByStage: Record<string, PipelineCard[]> = {};
  for (const st of stages) {
    const rows = await db()
      .select({
        id: schema.leads.id,
        name: schema.leads.name,
        phone: schema.leads.phone,
        platform: schema.leads.platform,
        aiScore: schema.leads.aiScore,
        stageId: schema.leads.stageId,
        createdAt: schema.leads.createdAt,
        campaign: schema.campaigns.name,
      })
      .from(schema.leads)
      .leftJoin(schema.campaigns, eq(schema.leads.campaignId, schema.campaigns.id))
      .where(
        and(
          eq(schema.leads.workspaceId, workspaceId),
          eq(schema.leads.stageId, st.id),
        ),
      )
      .orderBy(desc(schema.leads.createdAt))
      .limit(PIPELINE_CARD_CAP);

    cardsByStage[st.id] = rows.map((r) => ({
      id: r.id,
      name: r.name ?? "Unknown",
      campaign: r.campaign ?? "—",
      platform: r.platform,
      phone: r.phone ?? "—",
      aiScore: r.aiScore,
      stageId: r.stageId,
      createdAt: r.createdAt,
    }));
  }

  return { stages, cardsByStage, counts, cap: PIPELINE_CARD_CAP };
}

