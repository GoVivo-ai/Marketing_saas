/**
 * Backfills ad-set attribution for existing leads by querying Meta for each
 * lead directly (GET /{lead_id}?fields=adset_id) — works even when the ad is
 * archived/deleted, unlike the per-ad sync route. Then geocodes lead cities
 * that are still missing coordinates, and finally recomputes the in-radius
 * score boost for every scored lead (idempotent: ai_score - radius_boost is
 * the stable AI base).
 *
 *   npx tsx scripts/backfill-lead-attribution.ts          # all workspaces
 *   npx tsx scripts/backfill-lead-attribution.ts <ws-id>  # one workspace
 */
process.loadEnvFile(".env.local");

import { and, eq, isNull, isNotNull, ne } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { decryptSecret } from "../src/lib/crypto";
import { getSecret } from "../src/lib/settings";
import { geocodeCityCached } from "../src/lib/integrations/geocode";
import { radiusBoost } from "../src/lib/geo";

const GRAPH = "https://graph.facebook.com/v23.0";

async function fetchLeadAdset(
  leadExternalId: string,
  token: string,
): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(
      `${GRAPH}/${leadExternalId}?fields=adset_id`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.ok) {
      const body = (await res.json()) as { adset_id?: string };
      return body.adset_id ?? null;
    }
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    return null; // permission/deleted/etc. — nothing to attribute
  }
  return null;
}

async function main() {
  const onlyWorkspace = process.argv[2];

  const connections = await db()
    .select()
    .from(schema.connections)
    .where(
      and(
        eq(schema.connections.platform, "meta"),
        eq(schema.connections.status, "active"),
        ...(onlyWorkspace ? [eq(schema.connections.workspaceId, onlyWorkspace)] : []),
      ),
    );

  for (const conn of connections) {
    const token = conn.accessTokenEnc
      ? decryptSecret(conn.accessTokenEnc)
      : await getSecret("meta_access_token");
    if (!token) {
      console.log(`[${conn.workspaceId}] no Meta token — skipped`);
      continue;
    }

    // Ad sets of this workspace, by Meta external id.
    const adsets = await db()
      .select({
        id: schema.adsets.id,
        externalId: schema.adsets.externalId,
        region: schema.adsets.cityRegion,
        country: schema.adsets.cityCountry,
      })
      .from(schema.adsets)
      .where(eq(schema.adsets.workspaceId, conn.workspaceId));
    const adsetByExternal = new Map(adsets.map((a) => [a.externalId, a]));

    // 1) Attribution: leads with a Meta id but no ad set.
    const unattributed = await db()
      .select({ id: schema.leads.id, externalId: schema.leads.externalId })
      .from(schema.leads)
      .where(
        and(
          eq(schema.leads.workspaceId, conn.workspaceId),
          eq(schema.leads.platform, "meta"),
          isNull(schema.leads.adsetId),
          isNotNull(schema.leads.externalId),
        ),
      );
    let attributed = 0;
    for (const lead of unattributed) {
      const adsetExternal = await fetchLeadAdset(lead.externalId!, token);
      const adset = adsetExternal ? adsetByExternal.get(adsetExternal) : null;
      if (adset) {
        await db()
          .update(schema.leads)
          .set({ adsetId: adset.id })
          .where(eq(schema.leads.id, lead.id));
        attributed++;
      }
    }
    console.log(
      `[${conn.workspaceId}] attribution: ${attributed}/${unattributed.length} leads linked to an ad set`,
    );

    // 2) Geocode lead cities that still have no coordinates (cache-backed,
    //    Nominatim is rate-limited — the helper throttles).
    const ungeocoded = await db()
      .select({
        id: schema.leads.id,
        geoCity: schema.leads.geoCity,
        adsetId: schema.leads.adsetId,
      })
      .from(schema.leads)
      .where(
        and(
          eq(schema.leads.workspaceId, conn.workspaceId),
          isNotNull(schema.leads.geoCity),
          isNull(schema.leads.geoLat),
        ),
      );
    const adsetById = new Map(adsets.map((a) => [a.id, a]));
    let geocoded = 0;
    for (const lead of ungeocoded) {
      const hint = lead.adsetId ? adsetById.get(lead.adsetId) : undefined;
      const geo = await geocodeCityCached(
        lead.geoCity!,
        hint?.region ?? undefined,
        hint?.country ?? undefined,
      );
      if (geo) {
        await db()
          .update(schema.leads)
          .set({ geoLat: geo.lat.toFixed(6), geoLng: geo.lng.toFixed(6) })
          .where(eq(schema.leads.id, lead.id));
        geocoded++;
      }
    }
    console.log(
      `[${conn.workspaceId}] geocoding: ${geocoded}/${ungeocoded.length} lead cities located`,
    );

    // 3) Recompute the radius boost for scored, attributed leads.
    const scored = await db()
      .select({
        id: schema.leads.id,
        aiScore: schema.leads.aiScore,
        oldBoost: schema.leads.radiusBoost,
        geoLat: schema.leads.geoLat,
        geoLng: schema.leads.geoLng,
        targetLat: schema.adsets.lat,
        targetLng: schema.adsets.lng,
        targetRadius: schema.adsets.radius,
        targetUnit: schema.adsets.distanceUnit,
      })
      .from(schema.leads)
      .innerJoin(schema.adsets, eq(schema.leads.adsetId, schema.adsets.id))
      .where(
        and(
          eq(schema.leads.workspaceId, conn.workspaceId),
          isNotNull(schema.leads.aiScore),
          ne(schema.leads.aiScore, 0),
        ),
      );
    let boosted = 0;
    for (const lead of scored) {
      const base = (lead.aiScore ?? 0) - lead.oldBoost;
      const target = radiusBoost(lead);
      const score = Math.min(100, base + target);
      const applied = score - base;
      if (score !== lead.aiScore || applied !== lead.oldBoost) {
        await db()
          .update(schema.leads)
          .set({ aiScore: score, radiusBoost: applied })
          .where(eq(schema.leads.id, lead.id));
        boosted++;
      }
    }
    console.log(
      `[${conn.workspaceId}] radius boost: ${boosted}/${scored.length} scores adjusted`,
    );
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
