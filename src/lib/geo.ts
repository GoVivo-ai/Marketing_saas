/** Shared geo math for lead-vs-target-radius checks. */

/** Distance in km between two lat/lng points (haversine). */
export function haversineKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Score points a lead earns for sitting inside its ad set's audience radius. */
export const RADIUS_BOOST_WITHIN = 10;
/** Smaller bump for "near" (≤ 1.5× the radius) — right outside the circle. */
export const RADIUS_BOOST_NEAR = 5;

/**
 * Radius score boost for a lead given its ad set's audience target.
 * Mirrors the in/near/outside verdict shown in the lead detail: within the
 * radius → +10, near (≤1.5×) → +5, outside or unknown → 0. When the ad set
 * has no explicit radius, Meta applied its city default — assume 25 mi/40 km
 * (same fallback the lead detail uses).
 */
export function radiusBoost(lead: {
  geoLat: string | number | null;
  geoLng: string | number | null;
  targetLat: string | number | null;
  targetLng: string | number | null;
  targetRadius: string | number | null;
  targetUnit: string | null;
}): number {
  if (
    lead.geoLat == null ||
    lead.geoLng == null ||
    lead.targetLat == null ||
    lead.targetLng == null
  ) {
    return 0;
  }
  const unit = lead.targetUnit === "kilometer" ? "kilometer" : "mile";
  const km = haversineKm(
    Number(lead.geoLat),
    Number(lead.geoLng),
    Number(lead.targetLat),
    Number(lead.targetLng),
  );
  const distance = unit === "kilometer" ? km : km / 1.60934;
  const radius =
    lead.targetRadius != null
      ? Number(lead.targetRadius)
      : unit === "kilometer"
        ? 40
        : 25;
  if (distance <= radius) return RADIUS_BOOST_WITHIN;
  if (distance <= radius * 1.5) return RADIUS_BOOST_NEAR;
  return 0;
}
