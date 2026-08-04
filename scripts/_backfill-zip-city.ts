/**
 * One-off: backfill geo city/lat/lng for leads whose form carried a ZIP under
 * a key findZip didn't recognize before (e.g. `post_code`). Idempotent — only
 * touches leads with geo_city IS NULL, geocodes via the cached resolver.
 */
process.loadEnvFile(".env.local");
import { eq, isNull, and, isNotNull } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { geocodeZipCached } from "../src/lib/integrations/geocode";

function findZip(formData: Record<string, unknown> | null): string | null {
  if (!formData) return null;
  for (const [key, value] of Object.entries(formData)) {
    const k = key.toLowerCase();
    if (/zip|postal|post.?code/.test(k) && value) {
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
      formData: schema.leads.formData,
    })
    .from(schema.leads)
    .where(and(isNull(schema.leads.geoCity), isNotNull(schema.leads.formData)));
  console.log("leads without geo_city:", rows.length);

  let updated = 0;
  let noZip = 0;
  let geoMiss = 0;
  for (const r of rows) {
    const zip = findZip(r.formData as Record<string, unknown> | null);
    if (!zip) {
      noZip++;
      continue;
    }
    const geo = await geocodeZipCached(zip);
    if (!geo) {
      geoMiss++;
      console.log("  geocode miss for ZIP", zip);
      continue;
    }
    await db()
      .update(schema.leads)
      .set({
        geoCity: geo.city ?? `ZIP ${zip}`,
        geoLat: geo.lat.toFixed(6),
        geoLng: geo.lng.toFixed(6),
      })
      .where(eq(schema.leads.id, r.id));
    updated++;
    if (updated % 50 === 0) console.log("  updated", updated);
  }
  console.log({ updated, noZip, geoMiss });
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
