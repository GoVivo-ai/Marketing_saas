import { cookies } from "next/headers";
import { and, asc, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema, isDatabaseConfigured } from "@/lib/db";
import { haversineKm } from "@/lib/geo";

/**
 * Read-side data layer for the product pages. Every function is scoped to
 * one workspace.
 */

export interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
  accentColor: string | null;
  /** Brand logo as a data URL (shown white next to the Vivo logo). */
  logoUrl: string | null;
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
  /** Where the lead sits relative to its ad set's audience radius. */
  geo: LeadGeo | null;
}

/** A lead's position relative to the targeted audience radius. */
export interface LeadGeo {
  status: "within" | "near" | "outside" | "no_location" | "no_target";
  /** City the lead reported in the form. */
  leadCity: string | null;
  /** City the ad set targeted. */
  targetCity: string | null;
  /** Effective radius used for the verdict (includes the default fallback). */
  radius: number | null;
  /** False when the ad set had no explicit radius and a default was assumed. */
  radiusKnown: boolean;
  unit: "mile" | "kilometer" | null;
  /** Distance from the lead's city to the target centre, in `unit`. */
  distance: number | null;
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
            logoUrl: schema.workspaces.logoUrl,
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
        logoUrl: schema.workspaces.logoUrl,
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
// Planner — monthly plan vs. actual executed
// ─────────────────────────────────────────────────────────────────────────

/** The planned funnel (zeroed when the canvas is blank — no plan loaded). */
export interface MonthlyPlanData {
  /** Saved plan id, null while the canvas is a blank draft. */
  id: string | null;
  /** User-facing plan name. */
  name: string;
  budget: number;
  targetCpl: number;
  /** Lead → sale conversion rate as a fraction (0.15 = 15%). */
  conversionRate: number;
  targetLeads: number;
  targetSales: number;
  notes: string | null;
  /** False until a saved plan is loaded into the canvas. */
  exists: boolean;
}

/** The reporting window the actuals were computed over. */
export interface PlannerPeriod {
  /** "YYYY-MM-DD" inclusive start. */
  start: string;
  /** "YYYY-MM-DD" inclusive end. */
  end: string;
  /** True when a custom campaign window (not the whole month) is in effect. */
  custom: boolean;
}

/** What was actually executed in the month, from synced metrics + pipeline. */
export interface MonthActuals {
  spend: number;
  leads: number;
  /** Leads that reached a "won" pipeline stage (created in the month). */
  sales: number;
  cpl: number;
  /** Cost per sale. */
  cpa: number;
  /** Actual lead → sale rate as a fraction. */
  convRate: number;
}

/** One targeted city: its saved goal and what it actually executed. */
export interface CityPlanRow {
  cityName: string;
  /** Full state/region name (e.g. "Florida"), when known. */
  region: string | null;
  targetResults: number;
  actualSpend: number;
  actualLeads: number;
  actualResults: number;
}

/** A pipeline stage with how many of the month's leads sit in it. */
export interface OpsStage {
  name: string;
  kind: string;
  count: number;
}

export interface PlannerData {
  /** Planned month as "YYYY-MM". */
  month: string;
  /** What a "result" is called for this client (e.g. Sales, Hires). */
  resultLabel: string;
  plan: MonthlyPlanData;
  actuals: MonthActuals;
  /** Per-city goals + actuals (cities come from the workspace's ad sets). */
  cities: CityPlanRow[];
  /** Operations funnel — the workspace's pipeline stages with lead counts. */
  opsFunnel: OpsStage[];
  /** The window (custom campaign period or full month) actuals cover. */
  period: PlannerPeriod;
}

/** Inclusive day bounds + exclusive next-month start for a given month. */
function monthBounds(monthStart: Date) {
  const start = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
  const nextMonth = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  const end = new Date(nextMonth.getTime() - 86_400_000); // last day of month
  return { start, end, nextMonth };
}

/**
 * Plan + actuals for one workspace, ready for the comparison view. With a
 * `planId` the saved plan is loaded into the canvas (its month becomes the
 * anchor); without one the canvas is a blank draft for `monthStart`.
 */
export async function getPlannerData(
  workspaceId: string,
  monthStart: Date,
  planId?: string,
): Promise<PlannerData> {
  // Fetch the plan first: its month anchors the view and its optional
  // campaign window scopes the actuals.
  const [planRow, wsRow] = await Promise.all([
    planId
      ? db()
          .select()
          .from(schema.monthlyPlans)
          .where(
            and(
              eq(schema.monthlyPlans.id, planId),
              eq(schema.monthlyPlans.workspaceId, workspaceId),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
    db()
      .select({ resultLabel: schema.workspaces.resultLabel })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId))
      .limit(1),
  ]);
  const p = planRow[0];

  const m = monthBounds(p ? new Date(`${p.month}T00:00:00`) : monthStart);
  const monthStartStr = dateStr(m.start);
  const monthKey = monthStartStr.slice(0, 7);
  // Effective window: the saved campaign period, else the whole calendar month.
  const startStr = p?.periodStart ?? monthStartStr;
  const endStr = p?.periodEnd ?? dateStr(m.end);
  const start = new Date(`${startStr}T00:00:00`);
  const nextMonth = new Date(new Date(`${endStr}T00:00:00`).getTime() + 86_400_000);

  const [metricRow, salesRow, cityTargets, citySpend, cityResults, opsRows] =
    await Promise.all([
    db()
      .select({
        spend: sql<string>`coalesce(sum(${schema.metricsDaily.spend}), 0)`,
        leads: sql<string>`coalesce(sum(${schema.metricsDaily.leads}), 0)`,
      })
      .from(schema.metricsDaily)
      .where(
        and(
          eq(schema.metricsDaily.workspaceId, workspaceId),
          gte(schema.metricsDaily.date, startStr),
          lte(schema.metricsDaily.date, endStr),
        ),
      ),
    db()
      .select({ n: sql<string>`count(*)` })
      .from(schema.leads)
      .innerJoin(schema.stages, eq(schema.leads.stageId, schema.stages.id))
      .where(
        and(
          eq(schema.leads.workspaceId, workspaceId),
          eq(schema.stages.kind, "won"),
          gte(schema.leads.createdAt, start),
          lt(schema.leads.createdAt, nextMonth),
        ),
      ),
    // Saved per-city goals — keyed to the loaded plan (none on a blank canvas).
    p
      ? db()
          .select({
            cityName: schema.planCityTargets.cityName,
            region: schema.planCityTargets.region,
            targetResults: schema.planCityTargets.targetResults,
          })
          .from(schema.planCityTargets)
          .where(eq(schema.planCityTargets.planId, p.id))
      : Promise.resolve([]),
    // Actual spend & leads per city (via ad sets) for the month.
    db()
      .select({
        cityName: schema.adsets.cityName,
        region: sql<string | null>`max(${schema.adsets.cityRegion})`,
        spend: sql<string>`coalesce(sum(${schema.adsetMetricsDaily.spend}), 0)`,
        leads: sql<string>`coalesce(sum(${schema.adsetMetricsDaily.leads}), 0)`,
      })
      .from(schema.adsetMetricsDaily)
      .innerJoin(schema.adsets, eq(schema.adsetMetricsDaily.adsetId, schema.adsets.id))
      .where(
        and(
          eq(schema.adsetMetricsDaily.workspaceId, workspaceId),
          gte(schema.adsetMetricsDaily.date, startStr),
          lte(schema.adsetMetricsDaily.date, endStr),
        ),
      )
      .groupBy(schema.adsets.cityName),
    // Actual results (won leads) per city for the month.
    db()
      .select({
        cityName: schema.adsets.cityName,
        n: sql<string>`count(*)`,
      })
      .from(schema.leads)
      .innerJoin(schema.adsets, eq(schema.leads.adsetId, schema.adsets.id))
      .innerJoin(schema.stages, eq(schema.leads.stageId, schema.stages.id))
      .where(
        and(
          eq(schema.leads.workspaceId, workspaceId),
          eq(schema.stages.kind, "won"),
          gte(schema.leads.createdAt, start),
          lt(schema.leads.createdAt, nextMonth),
        ),
      )
      .groupBy(schema.adsets.cityName),
    // Ops funnel: every pipeline stage with this month's lead count.
    db()
      .select({
        name: schema.stages.name,
        kind: schema.stages.kind,
        position: schema.stages.position,
        count: sql<number>`count(${schema.leads.id})::int`,
      })
      .from(schema.stages)
      .leftJoin(
        schema.leads,
        and(
          eq(schema.leads.stageId, schema.stages.id),
          gte(schema.leads.createdAt, start),
          lt(schema.leads.createdAt, nextMonth),
        ),
      )
      .where(eq(schema.stages.workspaceId, workspaceId))
      .groupBy(schema.stages.id, schema.stages.name, schema.stages.kind, schema.stages.position)
      .orderBy(asc(schema.stages.position)),
  ]);

  const opsFunnel: OpsStage[] = opsRows.map((r) => ({
    name: r.name,
    kind: r.kind,
    count: Number(r.count),
  }));

  // Build the per-city rows: union of cities that have a saved goal, spend or
  // results this month, keyed case-insensitively but displayed in proper case.
  const cityMap = new Map<string, CityPlanRow>();
  const upsertCity = (name: string | null, region?: string | null) => {
    if (!name) return null;
    const key = name.toLowerCase();
    let row = cityMap.get(key);
    if (!row) {
      row = { cityName: name, region: null, targetResults: 0, actualSpend: 0, actualLeads: 0, actualResults: 0 };
      cityMap.set(key, row);
    }
    if (region && !row.region) row.region = region;
    return row;
  };
  for (const t of cityTargets) {
    const row = upsertCity(t.cityName, t.region);
    if (row) row.targetResults = t.targetResults;
  }
  for (const s of citySpend) {
    const row = upsertCity(s.cityName, s.region);
    if (row) {
      row.actualSpend = Math.round(Number(s.spend) * 100) / 100;
      row.actualLeads = Number(s.leads);
    }
  }
  for (const c of cityResults) {
    const row = upsertCity(c.cityName);
    if (row) row.actualResults = Number(c.n);
  }
  const cities = [...cityMap.values()].sort(
    (a, b) => b.targetResults - a.targetResults || a.cityName.localeCompare(b.cityName),
  );

  const plan: MonthlyPlanData = {
    id: p?.id ?? null,
    name: p?.name ?? "",
    budget: p ? Number(p.budget) : 0,
    targetCpl: p ? Number(p.targetCpl) : 0,
    conversionRate: p ? Number(p.conversionRate) : 0,
    targetLeads: p ? p.targetLeads : 0,
    targetSales: p ? p.targetSales : 0,
    notes: p?.notes ?? null,
    exists: Boolean(p),
  };

  const spend = Number(metricRow[0]?.spend ?? 0);
  const leads = Number(metricRow[0]?.leads ?? 0);
  const sales = Number(salesRow[0]?.n ?? 0);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const actuals: MonthActuals = {
    spend: round2(spend),
    leads,
    sales,
    cpl: leads > 0 ? round2(spend / leads) : 0,
    cpa: sales > 0 ? round2(spend / sales) : 0,
    convRate: leads > 0 ? sales / leads : 0,
  };

  return {
    month: monthKey,
    resultLabel: wsRow[0]?.resultLabel ?? "Sales",
    plan,
    actuals,
    cities,
    opsFunnel,
    period: {
      start: startStr,
      end: endStr,
      custom: Boolean(p?.periodStart && p?.periodEnd),
    },
  };
}

/** One saved plan: its headline figures next to what was executed. */
export interface PlannerHistoryRow {
  id: string;
  name: string;
  month: string; // "YYYY-MM"
  budget: number;
  targetLeads: number;
  targetSales: number;
  targetCpl: number;
  spend: number;
  leads: number;
  sales: number;
  cpl: number;
}

/** Every saved plan for a workspace with its actuals, newest month first. */
export async function getPlannerHistory(
  workspaceId: string,
): Promise<PlannerHistoryRow[]> {
  const plans = await db()
    .select()
    .from(schema.monthlyPlans)
    .where(eq(schema.monthlyPlans.workspaceId, workspaceId))
    .orderBy(desc(schema.monthlyPlans.month), desc(schema.monthlyPlans.createdAt));
  if (!plans.length) return [];

  // Actuals grouped by month — two queries cover every saved month at once.
  const [spendRows, salesRows] = await Promise.all([
    db()
      .select({
        m: sql<string>`to_char(${schema.metricsDaily.date}, 'YYYY-MM')`,
        spend: sql<string>`coalesce(sum(${schema.metricsDaily.spend}), 0)`,
        leads: sql<string>`coalesce(sum(${schema.metricsDaily.leads}), 0)`,
      })
      .from(schema.metricsDaily)
      .where(eq(schema.metricsDaily.workspaceId, workspaceId))
      .groupBy(sql`to_char(${schema.metricsDaily.date}, 'YYYY-MM')`),
    db()
      .select({
        m: sql<string>`to_char(${schema.leads.createdAt}, 'YYYY-MM')`,
        n: sql<string>`count(*)`,
      })
      .from(schema.leads)
      .innerJoin(schema.stages, eq(schema.leads.stageId, schema.stages.id))
      .where(
        and(
          eq(schema.leads.workspaceId, workspaceId),
          eq(schema.stages.kind, "won"),
        ),
      )
      .groupBy(sql`to_char(${schema.leads.createdAt}, 'YYYY-MM')`),
  ]);

  const spendByMonth = new Map(spendRows.map((r) => [r.m, r]));
  const salesByMonth = new Map(salesRows.map((r) => [r.m, Number(r.n)]));
  const round2 = (n: number) => Math.round(n * 100) / 100;

  return plans.map((p) => {
    const month = String(p.month).slice(0, 7);
    const sp = spendByMonth.get(month);
    const spend = round2(Number(sp?.spend ?? 0));
    const leads = Number(sp?.leads ?? 0);
    return {
      id: p.id,
      name: p.name,
      month,
      budget: Number(p.budget),
      targetLeads: p.targetLeads,
      targetSales: p.targetSales,
      targetCpl: Number(p.targetCpl),
      spend,
      leads,
      sales: salesByMonth.get(month) ?? 0,
      cpl: leads > 0 ? round2(spend / leads) : 0,
    };
  });
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

/** Campaigns that have at least one lead — for the leads filter dropdown. */
export async function getLeadCampaignOptions(
  workspaceId: string,
): Promise<{ id: string; name: string }[]> {
  const rows = await db()
    .selectDistinct({ id: schema.campaigns.id, name: schema.campaigns.name })
    .from(schema.leads)
    .innerJoin(schema.campaigns, eq(schema.leads.campaignId, schema.campaigns.id))
    .where(eq(schema.leads.workspaceId, workspaceId));
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getLeadsPage(
  workspaceId: string,
  opts: {
    start?: Date | null;
    end?: Date | null;
    page?: number;
    pageSize?: number;
    campaignId?: string | null;
  } = {},
): Promise<LeadsPage> {
  const { start, end, pageSize = 25, campaignId } = opts;
  // start/end null or omitted → unbounded on that side (all time when both).
  // Filtered against the lead's createdAt timestamp.
  const filters = [eq(schema.leads.workspaceId, workspaceId)];
  if (start) filters.push(gte(schema.leads.createdAt, start));
  if (end) filters.push(lte(schema.leads.createdAt, end));
  if (campaignId) filters.push(eq(schema.leads.campaignId, campaignId));
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
      leadCity: schema.leads.geoCity,
      leadLat: schema.leads.geoLat,
      leadLng: schema.leads.geoLng,
      targetCity: schema.adsets.cityName,
      targetLat: schema.adsets.lat,
      targetLng: schema.adsets.lng,
      targetRadius: schema.adsets.radius,
      targetUnit: schema.adsets.distanceUnit,
    })
    .from(schema.leads)
    .leftJoin(schema.campaigns, eq(schema.leads.campaignId, schema.campaigns.id))
    .leftJoin(schema.users, eq(schema.leads.assignedToId, schema.users.id))
    .leftJoin(schema.stages, eq(schema.leads.stageId, schema.stages.id))
    .leftJoin(schema.adsets, eq(schema.leads.adsetId, schema.adsets.id))
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
    geo: leadGeo(r),
  }));

  return { rows: mapped, total, page, pageSize, totalPages };
}

/** Classify a lead against its ad set's audience radius (near = ≤ 1.5× radius). */
function leadGeo(r: {
  leadCity: string | null;
  leadLat: string | null;
  leadLng: string | null;
  targetCity: string | null;
  targetLat: string | null;
  targetLng: string | null;
  targetRadius: string | null;
  targetUnit: string | null;
}): LeadGeo | null {
  const hasLead = r.leadLat != null && r.leadLng != null;
  const hasTarget = r.targetLat != null && r.targetLng != null;
  const unit = r.targetUnit === "kilometer" ? "kilometer" : "mile";

  if (!hasTarget) {
    return {
      status: "no_target",
      leadCity: r.leadCity,
      targetCity: r.targetCity,
      radius: null,
      radiusKnown: false,
      unit: null,
      distance: null,
    };
  }
  if (!hasLead) {
    return {
      status: "no_location",
      leadCity: r.leadCity,
      targetCity: r.targetCity,
      radius: r.targetRadius != null ? Number(r.targetRadius) : null,
      radiusKnown: r.targetRadius != null,
      unit,
      distance: null,
    };
  }

  const km = haversineKm(
    Number(r.leadLat),
    Number(r.leadLng),
    Number(r.targetLat),
    Number(r.targetLng),
  );
  const distance = unit === "kilometer" ? km : km / 1.60934;
  const radiusKnown = r.targetRadius != null;
  // Most city targets have no explicit radius (Meta uses the city default);
  // fall back to a sensible default so we can still give a verdict.
  const radius = radiusKnown ? Number(r.targetRadius) : unit === "kilometer" ? 40 : 25;
  const status =
    distance <= radius ? "within" : distance <= radius * 1.5 ? "near" : "outside";

  return {
    status,
    leadCity: r.leadCity,
    targetCity: r.targetCity,
    radius,
    radiusKnown,
    unit,
    distance: Math.round(distance * 10) / 10,
  };
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

