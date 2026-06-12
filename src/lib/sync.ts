import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getConnector } from "@/lib/integrations";
import { listAdSets, fetchAdSetDailyMetrics } from "@/lib/integrations/meta";
import { geocodeCity, geocodeCityCached } from "@/lib/integrations/geocode";
import { decryptSecret } from "@/lib/crypto";
import { getSecret } from "@/lib/settings";
import { scoreLead, radiusBoostByLeadId, withRadiusBoost } from "@/lib/ai/lead-scoring";
import { isAiConfigured } from "@/lib/ai/provider";

export interface SyncStats {
  campaigns: number;
  metricRows: number;
  /** Ad sets upserted (Meta only). */
  adsets: number;
  /** Ad-set daily metric rows upserted (Meta only). */
  adsetMetricRows: number;
  leads: number;
  /** How many newly-synced leads the AI engine scored this run. */
  leadsScored: number;
  leadsError?: string;
}

const dateStr = (d: Date) => d.toISOString().slice(0, 10);

/** Pull the lead's self-reported city from its form answers, if present. */
function findCity(formData: Record<string, unknown> | null | undefined): string | null {
  if (!formData) return null;
  for (const [key, value] of Object.entries(formData)) {
    const k = key.toLowerCase();
    if ((k === "city" || k === "ciudad" || k === "town" || /\bcity\b|ciudad/.test(k)) && value) {
      const v = String(value).trim();
      if (v) return v;
    }
  }
  return null;
}

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

  const [workspace] = await db()
    .select({
      name: schema.workspaces.name,
      industry: schema.workspaces.industry,
      qualificationCriteria: schema.workspaces.qualificationCriteria,
    })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, conn.workspaceId))
    .limit(1);

  const accessToken = conn.accessTokenEnc
    ? decryptSecret(conn.accessTokenEnc)
    : await getSecret("meta_access_token");
  if (!accessToken) {
    throw new Error(
      `Connection ${connectionId} has no token — configure the Meta token in Settings → Connections`,
    );
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

  // 2b) Ad sets + their audience-location targeting + daily metrics.
  // Meta-specific (geo targeting lives on the ad set). Geocoding is cached:
  // we only hit Nominatim when an ad set is new or its city changed.
  let adsetCount = 0;
  let adsetMetricRows = 0;
  // External ad-set id → internal id, reused below to attribute leads to the
  // ad set whose audience-location radius they fall under.
  let adsetIdByExternal = new Map<string, string>();
  // External ad-set id → its city region/country, used as a hint when
  // geocoding the lead's (often bare) city name.
  const adsetGeoByExternal = new Map<string, { region?: string; country?: string }>();
  if (conn.platform === "meta") {
    const prevAdsets = await db()
      .select({
        externalId: schema.adsets.externalId,
        cityName: schema.adsets.cityName,
        lat: schema.adsets.lat,
        lng: schema.adsets.lng,
      })
      .from(schema.adsets)
      .where(eq(schema.adsets.connectionId, conn.id));
    const prevByExternal = new Map(prevAdsets.map((r) => [r.externalId, r]));

    const adsets = await listAdSets(creds);
    for (const a of adsets) {
      const campaignId = campaignIdByExternal.get(a.campaignExternalId);
      if (!campaignId) continue; // ad set's campaign isn't tracked — skip
      if (a.city)
        adsetGeoByExternal.set(a.externalId, {
          region: a.city.region,
          country: a.city.country,
        });

      // Resolve coordinates: reuse the stored pin when the city is unchanged,
      // otherwise geocode the (new) city. Numeric columns come back as strings.
      let lat: string | null = null;
      let lng: string | null = null;
      if (a.city) {
        const prev = prevByExternal.get(a.externalId);
        if (prev?.lat != null && prev.lng != null && prev.cityName === a.city.name) {
          lat = prev.lat;
          lng = prev.lng;
        } else {
          const geo = await geocodeCity(a.city.name, a.city.region, a.city.country);
          if (geo) {
            lat = geo.lat.toFixed(6);
            lng = geo.lng.toFixed(6);
          }
        }
      }

      const fields = {
        name: a.name,
        status: a.status,
        cityName: a.city?.name ?? null,
        cityRegion: a.city?.region ?? null,
        cityCountry: a.city?.country ?? null,
        radius: a.city?.radius != null ? a.city.radius.toFixed(2) : null,
        distanceUnit: a.city?.distanceUnit ?? null,
        lat,
        lng,
      };
      await db()
        .insert(schema.adsets)
        .values({
          workspaceId: conn.workspaceId,
          connectionId: conn.id,
          campaignId,
          platform: conn.platform,
          externalId: a.externalId,
          ...fields,
        })
        .onConflictDoUpdate({
          target: [schema.adsets.connectionId, schema.adsets.externalId],
          set: fields,
        });
      adsetCount++;
    }

    const adsetRows = await db()
      .select({ id: schema.adsets.id, externalId: schema.adsets.externalId })
      .from(schema.adsets)
      .where(eq(schema.adsets.connectionId, conn.id));
    adsetIdByExternal = new Map(adsetRows.map((r) => [r.externalId, r.id]));

    const adsetMetrics = await fetchAdSetDailyMetrics(creds, range);
    for (const m of adsetMetrics) {
      const adsetId = adsetIdByExternal.get(m.adsetExternalId);
      if (!adsetId) continue;
      await db()
        .insert(schema.adsetMetricsDaily)
        .values({
          workspaceId: conn.workspaceId,
          adsetId,
          date: m.date,
          spend: m.spend.toFixed(2),
          impressions: m.impressions,
          clicks: m.clicks,
          leads: m.leads,
          conversions: m.conversions,
          extra: m.extra,
        })
        .onConflictDoUpdate({
          target: [schema.adsetMetricsDaily.adsetId, schema.adsetMetricsDaily.date],
          set: {
            spend: m.spend.toFixed(2),
            impressions: m.impressions,
            clicks: m.clicks,
            leads: m.leads,
            conversions: m.conversions,
            extra: m.extra,
          },
        });
      adsetMetricRows++;
    }
  }

  // 3) Leads — non-fatal: lead retrieval needs page access and can fail
  // independently of metrics.
  let leadCount = 0;
  let leadsError: string | undefined;
  // Leads that were actually inserted this run (not duplicates), so we only
  // pay for an AI score once per lead instead of on every re-sync.
  const freshLeads: { id: string; formData: Record<string, unknown> }[] = [];
  // Newly-synced leads land in the workspace's first open stage.
  const [defaultStage] = await db()
    .select({ id: schema.stages.id })
    .from(schema.stages)
    .where(
      and(
        eq(schema.stages.workspaceId, conn.workspaceId),
        eq(schema.stages.kind, "open"),
      ),
    )
    .orderBy(asc(schema.stages.position))
    .limit(1);
  try {
    const leads = await connector.fetchLeads(creds, range);
    for (const l of leads) {
      // Resolve the lead's campaign. If its campaign wasn't in the account-level
      // listing (e.g. archived/deleted) but the lead carries its details, create
      // the campaign on the fly so the lead can still be attributed.
      let campaignId = l.campaignExternalId
        ? campaignIdByExternal.get(l.campaignExternalId)
        : undefined;
      if (!campaignId && l.campaignExternalId && l.campaignName) {
        const [created] = await db()
          .insert(schema.campaigns)
          .values({
            workspaceId: conn.workspaceId,
            connectionId: conn.id,
            platform: conn.platform,
            externalId: l.campaignExternalId,
            name: l.campaignName,
            status: l.campaignStatus ?? "ARCHIVED",
            objective: l.campaignObjective,
          })
          .onConflictDoUpdate({
            target: [schema.campaigns.connectionId, schema.campaigns.externalId],
            set: { name: l.campaignName },
          })
          .returning({ id: schema.campaigns.id });
        if (created) {
          campaignId = created.id;
          campaignIdByExternal.set(l.campaignExternalId, created.id);
        }
      }

      // Attribute the lead to its ad set (carries the radius) and geocode the
      // city it reported in the form so we can flag in/near/outside the radius.
      const adsetId = l.adsetExternalId
        ? adsetIdByExternal.get(l.adsetExternalId) ?? null
        : null;
      const cityRaw = findCity(l.formData);
      let geoLat: string | null = null;
      let geoLng: string | null = null;
      if (cityRaw) {
        const hint = l.adsetExternalId ? adsetGeoByExternal.get(l.adsetExternalId) : undefined;
        const geo = await geocodeCityCached(cityRaw, hint?.region, hint?.country);
        if (geo) {
          geoLat = geo.lat.toFixed(6);
          geoLng = geo.lng.toFixed(6);
        }
      }

      const [inserted] = await db()
        .insert(schema.leads)
        .values({
          workspaceId: conn.workspaceId,
          campaignId,
          adsetId,
          geoCity: cityRaw,
          geoLat,
          geoLng,
          platform: conn.platform,
          externalId: l.externalId,
          name: l.name,
          email: l.email,
          phone: l.phone,
          formData: l.formData,
          stageId: defaultStage?.id ?? null,
          createdAt: new Date(l.createdAt),
        })
        // On re-sync, backfill the campaign for leads that were stored without
        // one — but never clobber a campaign already set, the stage, or score.
        // Ad-set attribution + geocoded location backfill too (keep old if the
        // new value is null, e.g. a geocode miss).
        .onConflictDoUpdate({
          target: [
            schema.leads.workspaceId,
            schema.leads.platform,
            schema.leads.externalId,
          ],
          set: {
            campaignId: sql`coalesce(${schema.leads.campaignId}, excluded.campaign_id)`,
            adsetId: sql`coalesce(excluded.adset_id, ${schema.leads.adsetId})`,
            geoCity: sql`coalesce(excluded.geo_city, ${schema.leads.geoCity})`,
            geoLat: sql`coalesce(excluded.geo_lat, ${schema.leads.geoLat})`,
            geoLng: sql`coalesce(excluded.geo_lng, ${schema.leads.geoLng})`,
          },
        })
        // xmax = 0 marks a fresh INSERT (vs. an ON CONFLICT update), so we
        // only score genuinely new leads — not every re-synced row.
        .returning({ id: schema.leads.id, isNew: sql<boolean>`(xmax = 0)` });
      leadCount++;
      if (inserted?.isNew) {
        freshLeads.push({
          id: inserted.id,
          formData: (l.formData ?? {}) as Record<string, unknown>,
        });
      }
    }
  } catch (err) {
    leadsError = err instanceof Error ? err.message : String(err);
  }

  // 4) AI lead scoring — score each newly-synced lead and store the result.
  // Non-fatal and skipped entirely when no Anthropic key is configured; a
  // single lead's failure never aborts the rest of the batch.
  let leadsScored = 0;
  if (freshLeads.length && workspace && (await isAiConfigured(conn.workspaceId))) {
    // In-radius leads score higher — they live where the service operates.
    const boosts = await radiusBoostByLeadId(freshLeads.map((l) => l.id));
    for (const lead of freshLeads) {
      try {
        const result = await scoreLead({
          workspaceId: conn.workspaceId,
          workspaceName: workspace.name,
          industry: workspace.industry ?? undefined,
          qualificationCriteria: workspace.qualificationCriteria ?? undefined,
          formData: lead.formData,
        });
        const { score, applied } = withRadiusBoost(
          result.score,
          boosts.get(lead.id) ?? 0,
        );
        await db()
          .update(schema.leads)
          .set({
            aiScore: score,
            radiusBoost: applied,
            aiScoreReason: result.reason,
            aiSuggestedAction: result.suggestedAction,
          })
          .where(eq(schema.leads.id, lead.id));
        leadsScored++;
      } catch {
        // Leave aiScore null — the inbox shows "Pending" and a later
        // re-score can fill it in. One bad lead shouldn't block the batch.
      }
    }
  }

  await db()
    .update(schema.connections)
    .set({ lastSyncedAt: new Date(), status: "active" })
    .where(eq(schema.connections.id, conn.id));

  return {
    campaigns: campaigns.length,
    metricRows,
    adsets: adsetCount,
    adsetMetricRows,
    leads: leadCount,
    leadsScored,
    leadsError,
  };
}
