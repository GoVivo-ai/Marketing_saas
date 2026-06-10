import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getConnector } from "@/lib/integrations";
import { decryptSecret } from "@/lib/crypto";

export interface SyncStats {
  campaigns: number;
  metricRows: number;
  leads: number;
  leadsError?: string;
}

const dateStr = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Pulls campaigns, daily metrics and leads for one connection and upserts
 * them into the workspace's tables. Idempotent: re-running refreshes the
 * same rows (metrics keyed by campaign+date, leads by external id).
 */
export async function syncConnection(
  connectionId: string,
  opts: { days?: number } = {},
): Promise<SyncStats> {
  const [conn] = await db()
    .select()
    .from(schema.connections)
    .where(eq(schema.connections.id, connectionId))
    .limit(1);
  if (!conn) throw new Error(`Connection not found: ${connectionId}`);

  const accessToken = conn.accessTokenEnc
    ? decryptSecret(conn.accessTokenEnc)
    : process.env.META_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error(`Connection ${connectionId} has no token and META_ACCESS_TOKEN is unset`);
  }

  const connector = getConnector(conn.platform);
  const creds = { accessToken, accountId: conn.accountId };
  const until = new Date();
  const since = new Date(until.getTime() - (opts.days ?? 30) * 86_400_000);
  const range = { since: dateStr(since), until: dateStr(until) };

  // 1) Campaigns
  const campaigns = await connector.listCampaigns(creds);
  for (const c of campaigns) {
    await db()
      .insert(schema.campaigns)
      .values({
        workspaceId: conn.workspaceId,
        connectionId: conn.id,
        platform: conn.platform,
        externalId: c.externalId,
        name: c.name,
        status: c.status,
        objective: c.objective,
        dailyBudget: c.dailyBudget?.toFixed(2),
      })
      .onConflictDoUpdate({
        target: [schema.campaigns.connectionId, schema.campaigns.externalId],
        set: {
          name: c.name,
          status: c.status,
          objective: c.objective,
          dailyBudget: c.dailyBudget?.toFixed(2),
        },
      });
  }
  const campaignRows = await db()
    .select({ id: schema.campaigns.id, externalId: schema.campaigns.externalId })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.connectionId, conn.id));
  const campaignIdByExternal = new Map(campaignRows.map((r) => [r.externalId, r.id]));

  // 2) Daily metrics
  const metrics = await connector.fetchDailyMetrics(creds, range);
  let metricRows = 0;
  for (const m of metrics) {
    const campaignId = campaignIdByExternal.get(m.campaignExternalId);
    if (!campaignId) continue;
    await db()
      .insert(schema.metricsDaily)
      .values({
        workspaceId: conn.workspaceId,
        campaignId,
        date: m.date,
        spend: m.spend.toFixed(2),
        impressions: m.impressions,
        clicks: m.clicks,
        leads: m.leads,
        conversions: m.conversions,
        extra: m.extra,
      })
      .onConflictDoUpdate({
        target: [schema.metricsDaily.campaignId, schema.metricsDaily.date],
        set: {
          spend: m.spend.toFixed(2),
          impressions: m.impressions,
          clicks: m.clicks,
          leads: m.leads,
          conversions: m.conversions,
          extra: m.extra,
        },
      });
    metricRows++;
  }

  // 3) Leads — non-fatal: lead retrieval needs page access and can fail
  // independently of metrics.
  let leadCount = 0;
  let leadsError: string | undefined;
  try {
    const leads = await connector.fetchLeads(creds, range);
    for (const l of leads) {
      await db()
        .insert(schema.leads)
        .values({
          workspaceId: conn.workspaceId,
          campaignId: l.campaignExternalId
            ? campaignIdByExternal.get(l.campaignExternalId)
            : undefined,
          platform: conn.platform,
          externalId: l.externalId,
          name: l.name,
          email: l.email,
          phone: l.phone,
          formData: l.formData,
          createdAt: new Date(l.createdAt),
        })
        .onConflictDoNothing();
      leadCount++;
    }
  } catch (err) {
    leadsError = err instanceof Error ? err.message : String(err);
  }

  await db()
    .update(schema.connections)
    .set({ lastSyncedAt: new Date(), status: "active" })
    .where(eq(schema.connections.id, conn.id));

  return { campaigns: campaigns.length, metricRows, leads: leadCount, leadsError };
}
