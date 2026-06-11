/**
 * Geocodes a targeted city to lat/lng via OpenStreetMap Nominatim — no API key
 * required. Used by the sync to place each ad set's audience location on the
 * map. Nominatim's usage policy caps us at ~1 request/second and requires a
 * descriptive User-Agent, so calls are serialized through a small throttle.
 */

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "vivo-marketing-os/1.0 (geo targeting map)";
const MIN_INTERVAL_MS = 1100;

let lastCall = 0;

async function throttle() {
  const now = Date.now();
  const wait = lastCall + MIN_INTERVAL_MS - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Resolve a city to coordinates. Returns null when nothing is found so callers
 * can persist the ad set without a map pin rather than failing the sync.
 */
export async function geocodeCity(
  city: string,
  region?: string | null,
  country?: string | null,
): Promise<LatLng | null> {
  const q = [city, region, country].filter(Boolean).join(", ");
  if (!q) return null;
  await throttle();
  try {
    const url = `${NOMINATIM}?q=${encodeURIComponent(q)}&format=json&limit=1`;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    const hit = data[0];
    if (!hit) return null;
    return { lat: Number(hit.lat), lng: Number(hit.lon) };
  } catch {
    return null;
  }
}
