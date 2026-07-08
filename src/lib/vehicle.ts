/** Shared vehicle-eligibility logic for lead qualification. */

/**
 * Minimum model year a lead's vehicle must be to qualify. VIVO only onboards
 * drivers whose vehicle is a 2015-or-newer model; anything older fails the
 * vehicle rule (RCA "Vehicle too old / Does not meet vehicle year").
 */
export const MIN_VEHICLE_YEAR = 2015;

/**
 * Pulls the vehicle model year from a lead's raw form answers, if present.
 * Meta delivers each lead-ad question as a `formData` key named after its
 * label, so we scan loosely — first keys explicitly about the year/model, then
 * broader vehicle keys — and take the first plausible 4-digit year.
 * Mirrors `findCity` in sync.ts, which parses the city the same way.
 */
export function parseVehicleYear(
  formData: Record<string, unknown> | null | undefined,
): number | null {
  if (!formData) return null;
  const thisYear = new Date().getFullYear();
  const entries = Object.entries(formData);
  // Two passes: prefer a key that names the year/model, then any vehicle key.
  const passes: ((k: string) => boolean)[] = [
    (k) => /\b(year|a[nñ]o|ano|modelo|model)\b/.test(k),
    (k) => /(veh[íi]culo|vehicle|\bcar\b|\bauto\b|carro)/.test(k),
  ];
  for (const match of passes) {
    for (const [key, value] of entries) {
      if (!match(key.toLowerCase())) continue;
      const year = extractYear(String(value ?? ""), thisYear);
      if (year != null) return year;
    }
  }
  return null;
}

/** First plausible model year in a string (1980 … current+1), or null. */
function extractYear(text: string, thisYear: number): number | null {
  const m = text.match(/\b(19[89]\d|20\d\d)\b/);
  if (!m) return null;
  const year = Number(m[1]);
  if (year < 1980 || year > thisYear + 1) return null;
  return year;
}
