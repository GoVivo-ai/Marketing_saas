import { cookies } from "next/headers";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema, isDatabaseConfigured } from "@/lib/db";
import { haversineKm } from "@/lib/geo";
import { MIN_VEHICLE_YEAR, vehicleAnswer } from "@/lib/vehicle";

/**
 * Ad platforms deliver campaign names in snake/underscore case
 * (e.g. "US_Miami_Owners_2024"). Show them with plain spaces so they read
 * naturally in the UI. Display-only — the stored name is left untouched.
 */
export function formatCampaignName(name: string | null | undefined): string {
  return (name ?? "").replaceAll("_", " ").replace(/\s+/g, " ").trim();
}

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
  scoringCriteria: string | null;
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
  /** RCA disqualification reason (Lvl 1/2/3), set on lost/not-qualified leads. */
  disqualL1: string | null;
  disqualL2: string | null;
  disqualL3: string | null;
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

/** A lead's answer to the vehicle-year eligibility question. */
export interface VehicleFit {
  /** eligible = answered Yes, too_old = answered No, unknown = not asked. */
  status: "eligible" | "too_old" | "unknown";
  /** Threshold model year the form asked about (e.g. 2012). */
  minYear: number;
}

/**
 * Classify a lead by its Yes/No answer to the Meta "vehicle model year N or
 * newer?" question. The answer is the verdict; the threshold year comes from
 * the question text (falling back to MIN_VEHICLE_YEAR for display).
 */
function vehicleFit(formData: Record<string, unknown> | null): VehicleFit {
  const { meets, year } = vehicleAnswer(formData);
  const status = meets == null ? "unknown" : meets ? "eligible" : "too_old";
  return { status, minYear: year ?? MIN_VEHICLE_YEAR };
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
        name: formatCampaignName(c.name),
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
        name: formatCampaignName(c.name),
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
      scoringCriteria: schema.campaigns.scoringCriteria,
    })
    .from(schema.campaigns)
    .where(
      and(
        eq(schema.campaigns.id, campaignId),
        eq(schema.campaigns.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return c ? { ...c, name: formatCampaignName(c.name) } : null;
}

export interface CampaignFormField {
  key: string;
  /** A representative answer from a recent lead, shown as context. */
  example: string;
}

/**
 * The distinct form questions leads answer in a campaign, each with a sample
 * answer. Surfaced next to the AI scoring-criteria editor so the operator can
 * see exactly which fields they can reference when writing the prompt.
 * Samples the most recent leads (fields vary lead to lead).
 */
export async function getCampaignFormFields(
  workspaceId: string,
  campaignId: string,
): Promise<CampaignFormField[]> {
  const rows = await db()
    .select({ formData: schema.leads.formData })
    .from(schema.leads)
    .where(
      and(
        eq(schema.leads.workspaceId, workspaceId),
        eq(schema.leads.campaignId, campaignId),
        isNotNull(schema.leads.formData),
      ),
    )
    .orderBy(desc(schema.leads.createdAt))
    .limit(50);

  const fields = new Map<string, string>();
  for (const r of rows) {
    for (const [key, value] of Object.entries(r.formData ?? {})) {
      if (fields.has(key)) continue;
      fields.set(key, typeof value === "string" ? value : JSON.stringify(value));
    }
  }
  return [...fields].map(([key, example]) => ({ key, example }));
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
  return rows
    .map((r) => ({ id: r.id, name: formatCampaignName(r.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Pipeline stages for the leads stage filter (ordered, with color). */
export async function getLeadStageOptions(
  workspaceId: string,
): Promise<{ id: string; name: string; color: string | null }[]> {
  return db()
    .select({
      id: schema.stages.id,
      name: schema.stages.name,
      color: schema.stages.color,
    })
    .from(schema.stages)
    .where(eq(schema.stages.workspaceId, workspaceId))
    .orderBy(asc(schema.stages.position));
}

/** Distinct lead cities — the spreadsheet's "Area" slicing for the inbox. */
export async function getLeadCityOptions(
  workspaceId: string,
): Promise<string[]> {
  const rows = await db()
    .selectDistinct({ city: schema.leads.geoCity })
    .from(schema.leads)
    .where(
      and(
        eq(schema.leads.workspaceId, workspaceId),
        isNotNull(schema.leads.geoCity),
      ),
    );
  return rows
    .map((r) => r.city as string)
    .filter((c) => c.trim() !== "")
    .sort((a, b) => a.localeCompare(b));
}

export async function getLeadsPage(
  workspaceId: string,
  opts: {
    start?: Date | null;
    end?: Date | null;
    page?: number;
    pageSize?: number;
    campaignId?: string | null;
    stageId?: string | null;
    city?: string | null;
    /** Free-text search over the lead's name, email and phone. */
    q?: string | null;
  } = {},
): Promise<LeadsPage> {
  const { start, end, pageSize = 25, campaignId, stageId, city, q } = opts;
  // start/end null or omitted → unbounded on that side (all time when both).
  // Filtered against the lead's createdAt timestamp.
  const filters = [eq(schema.leads.workspaceId, workspaceId)];
  if (start) filters.push(gte(schema.leads.createdAt, start));
  if (end) filters.push(lte(schema.leads.createdAt, end));
  if (campaignId) filters.push(eq(schema.leads.campaignId, campaignId));
  if (stageId) filters.push(eq(schema.leads.stageId, stageId));
  if (city) filters.push(eq(schema.leads.geoCity, city));
  // Find a specific lead by name, email or phone (case-insensitive substring).
  if (q) {
    const like = `%${q}%`;
    const search = or(
      ilike(schema.leads.name, like),
      ilike(schema.leads.email, like),
      ilike(schema.leads.phone, like),
    );
    if (search) filters.push(search);
  }
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
      disqualL1: schema.leads.disqualL1,
      disqualL2: schema.leads.disqualL2,
      disqualL3: schema.leads.disqualL3,
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
    campaign: formatCampaignName(r.campaign) || "—",
    platform: r.platform,
    externalId: r.externalId,
    status: r.status,
    stageId: r.stageId,
    stageName: r.stageName,
    stageColor: r.stageColor,
    aiScore: r.aiScore,
    aiReason: r.aiReason,
    aiSuggestedAction: r.aiSuggestedAction,
    disqualL1: r.disqualL1,
    disqualL2: r.disqualL2,
    disqualL3: r.disqualL3,
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
  email: string;
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
        email: schema.leads.email,
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
      campaign: formatCampaignName(r.campaign) || "—",
      platform: r.platform,
      phone: r.phone ?? "—",
      email: r.email ?? "—",
      aiScore: r.aiScore,
      stageId: r.stageId,
      createdAt: r.createdAt,
    }));
  }

  return { stages, cardsByStage, counts, cap: PIPELINE_CARD_CAP };
}

// ─────────────────────────────────────────────────────────────────────────
// Contact queue — "who to work next", the spreadsheet's 2nd/3rd-outreach
// columns turned into an ordered list: overdue follow-ups first (oldest touch
// first), then untouched leads by AI score. Leads whose last outcome resolved
// the conversation (answered/replied/not interested/wrong number) and leads
// still inside the follow-up window are left out.
// ─────────────────────────────────────────────────────────────────────────

export interface QueueItem {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  campaign: string | null;
  stageName: string | null;
  stageColor: string | null;
  aiScore: number | null;
  aiSuggestedAction: string | null;
  createdAt: Date;
  geo: LeadGeo | null;
  /** Whether the lead's vehicle meets the minimum-year eligibility rule. */
  vehicle: VehicleFit;
  /** Outreach touches so far (calls/SMS/emails/WhatsApp, manual or platform). */
  touches: number;
  lastTouchAt: Date | null;
  lastChannel: string | null;
  lastOutcome: string | null;
  /** Why the lead is queued: never touched vs. follow-up window elapsed. */
  due: "new" | "follow_up";
}

/** A contacted lead still inside the follow-up window — not workable yet. */
export interface WaitingItem {
  id: string;
  name: string;
  phone: string | null;
  campaign: string | null;
  aiScore: number | null;
  lastTouchAt: Date;
  lastChannel: string | null;
  /** When it re-enters the queue as a due follow-up (lastTouch + window). */
  dueAt: Date;
}

export interface ContactQueueData {
  items: QueueItem[];
  total: number;
  newCount: number;
  followUpCount: number;
  /** Touched leads still inside the follow-up window (not queued yet). */
  coolingDown: number;
  /** The waiting leads themselves, soonest to come back first. */
  waiting: WaitingItem[];
}

/** Days to wait after an unresolved touch before the lead re-enters the queue. */
export const FOLLOW_UP_AFTER_DAYS = 2;
const QUEUE_CAP = 100;

const QUEUE_OUTREACH_TYPES = ["call", "sms", "email", "whatsapp"];
/** Last outcomes that take a lead out of the chase loop. */
const RESOLVED_OUTCOMES = new Set([
  "answered",
  "replied",
  "not_interested",
  "wrong_number",
]);

/** The queue's "candidate" condition, shared with the ad-set option list. */
function queueCandidateWhere(workspaceId: string) {
  return and(
    eq(schema.leads.workspaceId, workspaceId),
    isNull(schema.leads.disqualL1),
    or(isNull(schema.leads.stageId), eq(schema.stages.kind, "open")),
  );
}

/**
 * Ad sets that still have workable leads — the queue's "today I'm working
 * Redondo Beach" slice. Labeled by targeted city when known (geo-per-city
 * accounts name ad sets after their city), with the live lead count.
 */
export async function getQueueAdsetOptions(
  workspaceId: string,
): Promise<{ id: string; label: string; count: number }[]> {
  const rows = await db()
    .select({
      id: schema.adsets.id,
      name: schema.adsets.name,
      city: schema.adsets.cityName,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.leads)
    .innerJoin(schema.adsets, eq(schema.leads.adsetId, schema.adsets.id))
    .leftJoin(schema.stages, eq(schema.leads.stageId, schema.stages.id))
    .where(queueCandidateWhere(workspaceId))
    .groupBy(schema.adsets.id, schema.adsets.name, schema.adsets.cityName);
  return rows
    .map((r) => ({ id: r.id, label: r.city ?? r.name, count: r.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export async function getContactQueue(
  workspaceId: string,
  opts: {
    adsetId?: string | null;
    /** Restrict to leads created inside this window (inclusive). */
    start?: Date | null;
    end?: Date | null;
  } = {},
): Promise<ContactQueueData> {
  // Candidates: open-stage (or unstaged) leads that aren't disqualified.
  const leadRows = await db()
    .select({
      id: schema.leads.id,
      name: schema.leads.name,
      phone: schema.leads.phone,
      email: schema.leads.email,
      aiScore: schema.leads.aiScore,
      aiSuggestedAction: schema.leads.aiSuggestedAction,
      createdAt: schema.leads.createdAt,
      campaign: schema.campaigns.name,
      stageName: schema.stages.name,
      stageColor: schema.stages.color,
      leadCity: schema.leads.geoCity,
      leadLat: schema.leads.geoLat,
      leadLng: schema.leads.geoLng,
      formData: schema.leads.formData,
      targetCity: schema.adsets.cityName,
      targetLat: schema.adsets.lat,
      targetLng: schema.adsets.lng,
      targetRadius: schema.adsets.radius,
      targetUnit: schema.adsets.distanceUnit,
    })
    .from(schema.leads)
    .leftJoin(schema.campaigns, eq(schema.leads.campaignId, schema.campaigns.id))
    .leftJoin(schema.stages, eq(schema.leads.stageId, schema.stages.id))
    .leftJoin(schema.adsets, eq(schema.leads.adsetId, schema.adsets.id))
    .where(
      and(
        queueCandidateWhere(workspaceId),
        opts.adsetId ? eq(schema.leads.adsetId, opts.adsetId) : undefined,
        opts.start ? gte(schema.leads.createdAt, opts.start) : undefined,
        opts.end ? lte(schema.leads.createdAt, opts.end) : undefined,
      ),
    );

  // Touch count + latest touch per lead, in two grouped queries (not per lead).
  const [agg, latest] = await Promise.all([
    db()
      .select({
        leadId: schema.leadEvents.leadId,
        touches: sql<number>`count(*)::int`,
        lastAt: sql<Date>`max(${schema.leadEvents.createdAt})`,
      })
      .from(schema.leadEvents)
      .innerJoin(schema.leads, eq(schema.leadEvents.leadId, schema.leads.id))
      .where(
        and(
          eq(schema.leads.workspaceId, workspaceId),
          inArray(schema.leadEvents.type, QUEUE_OUTREACH_TYPES),
        ),
      )
      .groupBy(schema.leadEvents.leadId),
    db()
      .selectDistinctOn([schema.leadEvents.leadId], {
        leadId: schema.leadEvents.leadId,
        type: schema.leadEvents.type,
        payload: schema.leadEvents.payload,
      })
      .from(schema.leadEvents)
      .innerJoin(schema.leads, eq(schema.leadEvents.leadId, schema.leads.id))
      .where(
        and(
          eq(schema.leads.workspaceId, workspaceId),
          inArray(schema.leadEvents.type, QUEUE_OUTREACH_TYPES),
        ),
      )
      .orderBy(schema.leadEvents.leadId, desc(schema.leadEvents.createdAt)),
  ]);
  const aggById = new Map(agg.map((a) => [a.leadId, a]));
  const latestById = new Map(latest.map((l) => [l.leadId, l]));

  const windowMs = FOLLOW_UP_AFTER_DAYS * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const items: QueueItem[] = [];
  const waiting: WaitingItem[] = [];
  let coolingDown = 0;

  for (const r of leadRows) {
    const a = aggById.get(r.id);
    const last = latestById.get(r.id);
    const payload = (last?.payload ?? {}) as Record<string, unknown>;
    // Platform-placed calls/SMS carry no outcome (the agent logs it after) —
    // treated as unresolved, so the lead comes back when the window elapses.
    const lastOutcome = typeof payload.outcome === "string" ? payload.outcome : null;
    const touches = a?.touches ?? 0;
    const lastTouchAt = a ? new Date(a.lastAt) : null;

    let due: QueueItem["due"];
    if (touches === 0) {
      due = "new";
    } else if (lastOutcome && RESOLVED_OUTCOMES.has(lastOutcome)) {
      continue; // conversation resolved — advance the stage or disqualify instead
    } else if (now - (lastTouchAt?.getTime() ?? now) >= windowMs) {
      due = "follow_up";
    } else {
      coolingDown++;
      if (lastTouchAt) {
        waiting.push({
          id: r.id,
          name: r.name ?? "Unknown",
          phone: r.phone,
          campaign: formatCampaignName(r.campaign) || null,
          aiScore: r.aiScore,
          lastTouchAt,
          lastChannel: last?.type ?? null,
          dueAt: new Date(lastTouchAt.getTime() + windowMs),
        });
      }
      continue;
    }

    items.push({
      id: r.id,
      name: r.name ?? "Unknown",
      phone: r.phone,
      email: r.email,
      campaign: formatCampaignName(r.campaign) || null,
      stageName: r.stageName,
      stageColor: r.stageColor,
      aiScore: r.aiScore,
      aiSuggestedAction: r.aiSuggestedAction,
      createdAt: r.createdAt,
      geo: leadGeo(r),
      vehicle: vehicleFit(r.formData as Record<string, unknown> | null),
      touches,
      lastTouchAt,
      lastChannel: last?.type ?? null,
      lastOutcome,
      due,
    });
  }

  // Overdue follow-ups first (longest-waiting first), then fresh leads by
  // score — the queue decides the order so the agent doesn't have to.
  items.sort((x, y) => {
    if (x.due !== y.due) return x.due === "follow_up" ? -1 : 1;
    if (x.due === "follow_up")
      return (x.lastTouchAt?.getTime() ?? 0) - (y.lastTouchAt?.getTime() ?? 0);
    return (
      (y.aiScore ?? -1) - (x.aiScore ?? -1) ||
      y.createdAt.getTime() - x.createdAt.getTime()
    );
  });

  waiting.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());

  return {
    items: items.slice(0, QUEUE_CAP),
    total: items.length,
    newCount: items.filter((i) => i.due === "new").length,
    followUpCount: items.filter((i) => i.due === "follow_up").length,
    coolingDown,
    waiting,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Funnel report — closes the spreadsheet's reporting gap: every lead counts
// from the moment it enters (not only once it completes Contractor
// Compliance), so each stage shows how many leads EVER REACHED it, whether
// they are still there, moved on, or were later lost.
// ─────────────────────────────────────────────────────────────────────────

export interface FunnelStep {
  id: string;
  name: string;
  color: string | null;
  kind: string;
  /** Leads that ever reached this stage (still here, past it, or lost after). */
  count: number;
  /** Share of all leads in the period. */
  pctOfTotal: number;
  /** Conversion from the previous step (null on the first). */
  pctOfPrev: number | null;
}

export interface FunnelReport {
  total: number;
  steps: FunnelStep[];
  lost: {
    count: number;
    pctOfTotal: number;
    /** Top RCA reasons (Lvl 1 › Lvl 3), most frequent first. */
    reasons: { l1: string; l3: string; count: number }[];
    /** Lost leads without an RCA reason recorded yet. */
    unclassified: number;
  };
}

export async function getFunnelReport(
  workspaceId: string,
  opts: { start?: Date | null; end?: Date | null } = {},
): Promise<FunnelReport> {
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
  // The funnel path: open stages in order, then the won stage.
  const path = [
    ...stages.filter((s) => s.kind === "open"),
    ...stages.filter((s) => s.kind === "won").slice(0, 1),
  ];
  const positionById = new Map(stages.map((s) => [s.id, s.position]));

  const leadFilters = [eq(schema.leads.workspaceId, workspaceId)];
  if (opts.start) leadFilters.push(gte(schema.leads.createdAt, opts.start));
  if (opts.end) leadFilters.push(lte(schema.leads.createdAt, opts.end));

  const [leadRows, moveRows] = await Promise.all([
    db()
      .select({
        id: schema.leads.id,
        stageId: schema.leads.stageId,
        disqualL1: schema.leads.disqualL1,
        disqualL3: schema.leads.disqualL3,
      })
      .from(schema.leads)
      .where(and(...leadFilters)),
    // Stage history: a lost lead still counts in every stage it passed
    // through, which the current stageId alone can't tell us.
    db()
      .select({
        leadId: schema.leadEvents.leadId,
        payload: schema.leadEvents.payload,
      })
      .from(schema.leadEvents)
      .innerJoin(schema.leads, eq(schema.leadEvents.leadId, schema.leads.id))
      .where(
        and(...leadFilters, eq(schema.leadEvents.type, "status_change")),
      ),
  ]);

  // Furthest position each lead ever reached (current stage + history).
  // Sitting in (or moving into) a lost stage isn't funnel progress — a lost
  // stage's position sits past the open ones and would otherwise count the
  // lead as having reached everything before it.
  const lostIds = new Set(
    stages.filter((s) => s.kind === "lost").map((s) => s.id),
  );
  const maxPos = new Map<string, number>();
  const bump = (leadId: string, stageId: unknown) => {
    if (typeof stageId !== "string" || lostIds.has(stageId)) return;
    const pos = positionById.get(stageId);
    if (pos == null) return;
    const prev = maxPos.get(leadId);
    if (prev == null || pos > prev) maxPos.set(leadId, pos);
  };
  for (const l of leadRows) bump(l.id, l.stageId);
  for (const m of moveRows) {
    const p = (m.payload ?? {}) as Record<string, unknown>;
    bump(m.leadId, p.fromStageId);
    bump(m.leadId, p.toStageId);
  }

  const total = leadRows.length;
  const steps: FunnelStep[] = path.map((stage, i) => {
    // Every lead reached the funnel's entry stage by definition.
    const count =
      i === 0
        ? total
        : leadRows.filter((l) => (maxPos.get(l.id) ?? -1) >= stage.position)
            .length;
    return {
      id: stage.id,
      name: stage.name,
      color: stage.color,
      kind: stage.kind,
      count,
      pctOfTotal: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
      pctOfPrev: null,
    };
  });
  for (let i = 1; i < steps.length; i++) {
    steps[i].pctOfPrev =
      steps[i - 1].count > 0
        ? Math.round((steps[i].count / steps[i - 1].count) * 1000) / 10
        : null;
  }

  // Lost breakdown by RCA — the "why" behind the funnel's leaks.
  const lostLeads = leadRows.filter(
    (l) => l.disqualL1 != null || (l.stageId != null && lostIds.has(l.stageId)),
  );
  const reasonCounts = new Map<string, { l1: string; l3: string; count: number }>();
  let unclassified = 0;
  for (const l of lostLeads) {
    if (!l.disqualL1) {
      unclassified++;
      continue;
    }
    const key = `${l.disqualL1}›${l.disqualL3 ?? ""}`;
    const entry = reasonCounts.get(key) ?? {
      l1: l.disqualL1,
      l3: l.disqualL3 ?? "—",
      count: 0,
    };
    entry.count++;
    reasonCounts.set(key, entry);
  }

  return {
    total,
    steps,
    lost: {
      count: lostLeads.length,
      pctOfTotal:
        total > 0 ? Math.round((lostLeads.length / total) * 1000) / 10 : 0,
      reasons: [...reasonCounts.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
      unclassified,
    },
  };
}

