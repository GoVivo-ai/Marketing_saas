/**
 * Fills leads.geo_region (the lead's own state) for every lead that lacks
 * one, and normalizes hand-typed values ("CA" → "California"; a city name
 * stored as the state → re-derived). Sources, strongest first: a state in
 * the form, a "City, ST" suffix, the ZIP, the geocoded city's state, the
 * phone's area code, the ad set's targeted state (see lib/lead-region.ts).
 *
 * Only leads that can't be settled offline hit Nominatim (once per distinct
 * city, ~1 req/s), so pass --offline to skip that and finish in seconds.
 *
 * Run: npx tsx scripts/backfill-lead-region.ts [--offline] [--workspace <slug>]
 */
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { geocodeCityCached } from "../src/lib/integrations/geocode";
import {
  findFormState,
  normalizeRegion,
  regionFromPhone,
  regionFromZip,
  resolveLeadRegion,
  splitCityRegion,
} from "../src/lib/lead-region";

if (!process.env.DATABASE_URL) {
  process.loadEnvFile(".env.local");
}

const args = process.argv.slice(2);
const offline = args.includes("--offline");
const wsIdx = args.indexOf("--workspace");
const wsSlug = wsIdx >= 0 ? args[wsIdx + 1] : null;

function findZip(formData: Record<string, unknown> | null): string | null {
  if (!formData) return null;
  for (const [key, value] of Object.entries(formData)) {
    if (/zip|postal|post.?code/i.test(key) && value) {
      const v = String(value).trim();
      if (/^\d{4,10}(-\d+)?$/.test(v)) return v;
    }
  }
  return null;
}

async function main() {
  const rows = await db()
    .select({
      id: schema.leads.id,
      workspace: schema.workspaces.slug,
      geoRegion: schema.leads.geoRegion,
      platform: schema.leads.platform,
      geoCity: schema.leads.geoCity,
      phone: schema.leads.phone,
      formData: schema.leads.formData,
      adsetRegion: schema.adsets.cityRegion,
      adsetCountry: schema.adsets.cityCountry,
    })
    .from(schema.leads)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.leads.workspaceId))
    .leftJoin(schema.adsets, eq(schema.leads.adsetId, schema.adsets.id))
    .where(wsSlug ? eq(schema.workspaces.slug, wsSlug) : sql`true`);

  const bySource: Record<string, number> = {};
  let updated = 0;
  // One UPDATE per batch — a round trip per lead is far too slow remotely.
  const BATCH = 500;
  const pending: { id: string; region: string }[] = [];
  async function flush() {
    if (!pending.length) return;
    const values = sql.join(
      pending.map((p) => sql`(${p.id}, ${p.region})`),
      sql`, `,
    );
    await db().execute(sql`
      update leads l set geo_region = v.region
      from (values ${values}) as v(id, region)
      where l.id = v.id`);
    updated += pending.length;
    pending.length = 0;
  }
  let unresolved = 0;
  let lookups = 0;

  for (const r of rows) {
    const formData = (r.formData ?? null) as Record<string, unknown> | null;
    // A state someone typed for a manual/public-form lead is trusted as-is
    // (normalized). Synced leads are re-derived every run so a weaker guess
    // (area code) gives way once a stronger source resolves.
    const stored = r.platform === "manual" ? normalizeRegion(r.geoRegion) : null;
    const zip = findZip(formData);
    const offlineHit =
      stored ??
      findFormState(formData) ??
      splitCityRegion(r.geoCity).region ??
      regionFromZip(zip);

    let geocodedRegion: string | null = null;
    if (!offlineHit && !offline && r.geoCity && !/^ZIP \d+$/.test(r.geoCity)) {
      lookups++;
      const geo = await geocodeCityCached(
        r.geoCity,
        r.adsetRegion,
        r.adsetCountry,
        { wantRegion: true },
      );
      geocodedRegion = geo?.region ?? null;
    }

    const region = resolveLeadRegion({
      formState: stored ?? findFormState(formData),
      city: r.geoCity,
      zip,
      geocodedRegion,
      phone: r.phone,
      adsetRegion: r.adsetRegion,
    });

    const source = stored
      ? "stored"
      : findFormState(formData)
        ? "form"
        : splitCityRegion(r.geoCity).region
          ? "city suffix"
          : regionFromZip(zip)
            ? "zip"
            : normalizeRegion(geocodedRegion)
              ? "geocoded city"
              : regionFromPhone(r.phone)
                ? "area code"
                : normalizeRegion(r.adsetRegion)
                  ? "ad set"
                  : "none";
    bySource[source] = (bySource[source] ?? 0) + 1;

    if (!region) {
      unresolved++;
      continue;
    }
    if (region === r.geoRegion) continue;
    pending.push({ id: r.id, region });
    if (pending.length >= BATCH) await flush();
  }
  await flush();

  console.log(`leads: ${rows.length}  updated: ${updated}  unresolved: ${unresolved}  nominatim lookups: ${lookups}`);
  console.log("by source:", bySource);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
