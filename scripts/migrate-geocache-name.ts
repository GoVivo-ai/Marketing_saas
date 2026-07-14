/**
 * Adds geocache.name (resolved place name, used by ZIP geocoding) and
 * backfills geo city/lat/lng for leads whose form only carried a ZIP code.
 * Idempotent. Run: npx tsx scripts/migrate-geocache-name.ts
 */
process.loadEnvFile(".env.local");

import postgres from "postgres";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const UA = "vivo-marketing-os/1.0 (geo targeting map)";

async function geocodeZip(zip: string): Promise<{ lat: number; lng: number; city: string | null } | null> {
  const url = `${NOMINATIM}?q=${encodeURIComponent(`${zip}, USA`)}&format=json&addressdetails=1&limit=1`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return null;
  const data = (await res.json()) as Array<{ lat: string; lon: string; address?: Record<string, string> }>;
  const hit = data[0];
  if (!hit) return null;
  const a = hit.address ?? {};
  return { lat: Number(hit.lat), lng: Number(hit.lon), city: a.city ?? a.town ?? a.village ?? a.suburb ?? a.county ?? null };
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  await sql`ALTER TABLE geocache ADD COLUMN IF NOT EXISTS name text`;
  console.log("geocache.name ensured.");

  const rows = await sql`
    SELECT id, form_data->>'código_postal' AS zip FROM leads
    WHERE geo_city IS NULL AND form_data->>'código_postal' IS NOT NULL`;
  const zips = [...new Set(rows.map((r) => String(r.zip).trim()))];
  console.log(`${rows.length} leads / ${zips.length} distinct ZIPs to resolve`);

  const resolved = new Map<string, { lat: number; lng: number; city: string | null }>();
  for (const zip of zips) {
    const key = `zip:${zip.toLowerCase()},usa`;
    const [cached] = await sql`SELECT lat, lng, name FROM geocache WHERE query = ${key}`;
    if (cached) { resolved.set(zip, { lat: Number(cached.lat), lng: Number(cached.lng), city: cached.name }); continue; }
    const geo = await geocodeZip(zip);
    if (geo) {
      resolved.set(zip, geo);
      await sql`INSERT INTO geocache (query, lat, lng, name) VALUES (${key}, ${geo.lat.toFixed(6)}, ${geo.lng.toFixed(6)}, ${geo.city}) ON CONFLICT DO NOTHING`;
      console.log(`  ${zip} → ${geo.city ?? "?"}`);
    } else console.log(`  ${zip} → not found`);
    await new Promise((r) => setTimeout(r, 1100)); // Nominatim rate limit
  }

  let updated = 0;
  for (const r of rows) {
    const geo = resolved.get(String(r.zip).trim());
    if (!geo) continue;
    await sql`UPDATE leads SET geo_city = ${geo.city ?? `ZIP ${r.zip}`},
      geo_lat = ${geo.lat.toFixed(6)}, geo_lng = ${geo.lng.toFixed(6)} WHERE id = ${r.id}`;
    updated++;
  }
  console.log(`Backfilled ${updated} leads.`);
  await sql.end();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
