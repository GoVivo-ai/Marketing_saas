/** Shared vehicle-eligibility logic for lead qualification. */

/**
 * Fallback threshold year, only used for display when the form question does
 * not state its own year. The real rule comes from the Meta lead-ad question
 * itself — e.g. "Do you have a vehicle model year 2012 or newer?" — which the
 * applicant answers Yes/No, so the ANSWER is the verdict and the year in the
 * question text is just what we show.
 */
export const MIN_VEHICLE_YEAR = 2012;

export interface VehicleAnswer {
  /** true = Yes (meets), false = No (doesn't), null = question not answered. */
  meets: boolean | null;
  /** Threshold year stated in the question text, if any (e.g. 2012). */
  year: number | null;
}

/**
 * Reads the vehicle-year eligibility answer from a lead's raw Meta form data.
 * The form asks a yes/no question ("Do you have a vehicle model year 2012 or
 * newer?"), so we find that question by its label and read the Yes/No answer;
 * the threshold year is parsed from the question text for display.
 */
export function vehicleAnswer(
  formData: Record<string, unknown> | null | undefined,
): VehicleAnswer {
  if (!formData) return { meets: null, year: null };
  for (const [key, value] of Object.entries(formData)) {
    const k = key.toLowerCase();
    const aboutVehicle = /(veh[íi]culo|vehicle|carro|\bcar\b|\bauto\b)/.test(k);
    const aboutYear = /\b(year|a[nñ]o|ano|model|modelo)\b/.test(k);
    if (!aboutVehicle || !aboutYear) continue;
    const meets = parseYesNo(String(value ?? ""));
    if (meets === null) continue;
    return { meets, year: extractYear(k) };
  }
  return { meets: null, year: null };
}

/** Interpret a Yes/No answer (English or Spanish), or null if not yes/no. */
function parseYesNo(text: string): boolean | null {
  const v = text.trim().toLowerCase();
  if (!v) return null;
  if (/^(yes|yeah|yep|y|s[íi]|si|s|true|1)\b/.test(v)) return true;
  if (/^(no|nope|n|false|0)\b/.test(v)) return false;
  return null;
}

/** First plausible 4-digit threshold year (2000–2039) in a string, or null. */
function extractYear(text: string): number | null {
  const m = text.match(/\b(20[0-3]\d)\b/);
  return m ? Number(m[1]) : null;
}
