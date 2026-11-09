/**
 * Re-geocodes every ad set city with the city-over-county rule and moves the
 * pins that were wrong (e.g. San Bernardino → the county seat in the Mojave,
 * 85 mi off). Fixes the geocache entries too, and re-applies the radius
 * boost on affected leads' scores so "Outside area" leads that are really in
 * town get their points back. Dry run by default.
 * Run: npx tsx scripts/fix-adset-geocodes.ts [--apply] [--min-miles 5]
 */
process.loadEnvFile(".env.local");

import postgres from "postgres";
import { geocodeCity } from "../src/lib/integrations/geocode";
import { haversineKm, radiusBoost } from "../src/lib/geo";

async function main() {
  const apply = process.argv.includes("--apply");
  const mi = process.argv.indexOf("--min-miles");
  const minMiles = mi > 0 ? Number(process.argv[mi + 1]) : 5;
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

  const cities = await sql<{ city: string; region: string | null; country: string | null; lat: string; lng: string; adsets: number }[]>`
    select city_name city, city_region region, city_country country, lat, lng, count(*)::int adsets
    from adsets where city_name is not null and lat is not null
    group by 1,2,3,4,5 order by 1`;

  const moves: { city: string; region: string | null; country: string | null; from: [number, number]; to: [number, number]; miles: number; adsets: number }[] = [];
  for (const c of cities) {
    const geo = await geocodeCity(c.city, c.region, c.country);
    if (!geo) continue;
    const miles = haversineKm(Number(c.lat), Number(c.lng), geo.lat, geo.lng) / 1.60934;
    if (miles >= minMiles)
      moves.push({ city: c.city, region: c.region, country: c.country, from: [Number(c.lat), Number(c.lng)], to: [geo.lat, geo.lng], miles: Math.round(miles), adsets: c.adsets });
  }
  console.table(moves.map((m) => ({ city: `${m.city}, ${m.region}`, adsets: m.adsets, miles_off: m.miles, new_lat: m.to[0].toFixed(5), new_lng: m.to[1].toFixed(5) })));
  if (!apply) {
    console.log(`Dry run — ${moves.length} cities would move. Re-run with --apply.`);
    await sql.end();
    return;
  }

  let leadsTouched = 0;
  for (const m of moves) {
    const lat = m.to[0].toFixed(6);
    const lng = m.to[1].toFixed(6);
    const adsets = await sql<{ id: string }[]>`
      update adsets set lat = ${lat}, lng = ${lng}
      where city_name = ${m.city} and city_region is not distinct from ${m.region}
        and city_country is not distinct from ${m.country}
        and lat = ${m.from[0].toFixed(6)} and lng = ${m.from[1].toFixed(6)}
      returning id`;
    const q = [m.city, m.region, m.country].filter(Boolean).join(", ").toLowerCase();
    await sql`update geocache set lat = ${lat}, lng = ${lng}
      where query in (${q}, ${m.city.toLowerCase()}) and lat = ${m.from[0].toFixed(6)}`;

    // Re-apply the radius boost on already-scored leads of these ad sets.
    const leads = await sql<{ id: string; geo_lat: string | null; geo_lng: string | null; radius: string | null; unit: string | null; ai_score: number | null; radius_boost: number }[]>`
      select l.id, l.geo_lat, l.geo_lng, a.radius, a.distance_unit unit, l.ai_score, l.radius_boost
      from leads l join adsets a on a.id = l.adset_id
      where a.id in ${sql(adsets.map((a) => a.id))} and l.ai_score is not null`;
    for (const l of leads) {
      const boost = radiusBoost({ geoLat: l.geo_lat, geoLng: l.geo_lng, targetLat: lat, targetLng: lng, targetRadius: l.radius, targetUnit: l.unit });
      if (boost === l.radius_boost) continue;
      const base = (l.ai_score ?? 0) - l.radius_boost;
      const score = Math.min(100, base + boost);
      await sql`update leads set ai_score = ${score}, radius_boost = ${score - base} where id = ${l.id}`;
      leadsTouched++;
    }
    console.log(`${m.city}: ${adsets.length} ad sets moved, ${leads.length} scored leads checked`);
  }
  console.log(`Leads re-boosted: ${leadsTouched}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
