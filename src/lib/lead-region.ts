/**
 * Resolves the US state a lead lives in from whatever the form and the
 * platform gave us. Meta rarely sends a state, so the location filters used
 * to lean on the ad set's targeted state alone; this derives the lead's own
 * state so "California over Florida" works even when the ad targeted
 * somewhere else.
 *
 * Sources, strongest first (see {@link resolveLeadRegion}):
 *   1. an explicit state in the form ("state", "estado", or a "City, ST" /
 *      "City (State)" suffix in the city answer)
 *   2. the ZIP code (3-digit prefix → state, offline)
 *   3. the state Nominatim returned when the city was geocoded
 *   4. the phone's area code (offline)
 *   5. the ad set's targeted state
 *
 * Every answer is the full state name ("California"), which is what the ad
 * sets already carry, so the two sources filter and dedupe together.
 */

const STATES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  PR: "Puerto Rico",
};

/** Every US state name, sorted — for pickers that should offer the full list. */
export const US_STATES: string[] = Object.values(STATES).sort();

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const BY_NAME = new Map<string, string>(
  Object.values(STATES).map((n) => [fold(n), n]),
);
// A few Spanish spellings agents and leads type by hand.
BY_NAME.set("nueva york", "New York");
BY_NAME.set("nuevo mexico", "New Mexico");
BY_NAME.set("carolina del norte", "North Carolina");
BY_NAME.set("carolina del sur", "South Carolina");
BY_NAME.set("virginia occidental", "West Virginia");
BY_NAME.set("dakota del norte", "North Dakota");
BY_NAME.set("dakota del sur", "South Dakota");
BY_NAME.set("nueva jersey", "New Jersey");
BY_NAME.set("hawai", "Hawaii");
BY_NAME.set("pensilvania", "Pennsylvania");
BY_NAME.set("luisiana", "Louisiana");
BY_NAME.set("misuri", "Missouri");
BY_NAME.set("misisipi", "Mississippi");
BY_NAME.set("oregon", "Oregon");

/**
 * Canonical state name for an abbreviation or a name in any casing/accent
 * ("ca", "CA", "california", "Nueva York"). Null when it isn't a US state.
 */
export function normalizeRegion(
  input: string | null | undefined,
): string | null {
  if (!input) return null;
  const raw = input.trim().replace(/\.$/, "");
  if (!raw) return null;
  const abbr = raw.toUpperCase();
  if (abbr.length === 2 && STATES[abbr]) return STATES[abbr];
  return BY_NAME.get(fold(raw)) ?? null;
}

/**
 * Splits a city answer that carries its state — "Las Vegas, NV",
 * "Sacramento (California)", "Phoenix AZ" — into the bare city and the
 * canonical state. City-only input comes back with region null.
 */
export function splitCityRegion(city: string | null | undefined): {
  city: string | null;
  region: string | null;
} {
  if (!city) return { city: null, region: null };
  const raw = city.trim();
  if (!raw) return { city: null, region: null };

  // "City (State)" / "City [State]"
  let m = raw.match(/^(.+?)\s*[([]\s*([^)\]]+?)\s*[)\]]\s*$/);
  if (m) {
    const region = normalizeRegion(m[2]);
    if (region) return { city: m[1].trim(), region };
  }
  // "City, ST" / "City, State" / "City, ST 90210" / "City, ST, USA"
  m = raw.match(/^(.+?)\s*,\s*([A-Za-z .]+?)(?:\s+\d{5}(?:-\d{4})?)?(?:\s*,\s*(?:usa|us|united states|estados unidos|ee\.? ?uu\.?))?\s*$/i);
  if (m) {
    const region = normalizeRegion(m[2]);
    if (region) return { city: m[1].trim(), region };
  }
  // "City ST" / "Las Vegas Nv" / "Palmdale Ca 93552" — a trailing 2-letter
  // code, capitalized (so "Santa Fe"-style endings aren't eaten), optionally
  // followed by a ZIP.
  m = raw.match(/^(.+?)\s+([A-Z][A-Za-z])\.?(?:\s+\d{5}(?:-\d{4})?)?$/);
  if (m) {
    const region = normalizeRegion(m[2]);
    if (region) return { city: m[1].trim(), region };
  }
  // A ZIP typed into the city answer ("Palmdale 93552", a full address).
  const zip = raw.match(/\b(\d{5})(?:-\d{4})?\b/);
  if (zip) {
    const region = regionFromZip(zip[1]);
    if (region) return { city: raw, region };
  }
  return { city: raw, region: null };
}

/** 3-digit ZIP prefix ranges → state (USPS allocation). */
const ZIP_RANGES: [number, number, string][] = [
  [5, 5, "NY"],
  [6, 9, "PR"],
  [10, 27, "MA"],
  [28, 29, "RI"],
  [30, 38, "NH"],
  [39, 49, "ME"],
  [50, 59, "VT"],
  [60, 69, "CT"],
  [70, 89, "NJ"],
  [100, 149, "NY"],
  [150, 196, "PA"],
  [197, 199, "DE"],
  [200, 200, "DC"],
  [201, 201, "VA"],
  [202, 205, "DC"],
  [206, 219, "MD"],
  [220, 246, "VA"],
  [247, 268, "WV"],
  [270, 289, "NC"],
  [290, 299, "SC"],
  [300, 319, "GA"],
  [320, 349, "FL"],
  [350, 369, "AL"],
  [370, 385, "TN"],
  [386, 397, "MS"],
  [398, 399, "GA"],
  [400, 427, "KY"],
  [430, 459, "OH"],
  [460, 479, "IN"],
  [480, 499, "MI"],
  [500, 528, "IA"],
  [530, 549, "WI"],
  [550, 567, "MN"],
  [570, 577, "SD"],
  [580, 588, "ND"],
  [590, 599, "MT"],
  [600, 629, "IL"],
  [630, 658, "MO"],
  [660, 679, "KS"],
  [680, 693, "NE"],
  [700, 714, "LA"],
  [716, 729, "AR"],
  [730, 749, "OK"],
  [750, 799, "TX"],
  [800, 816, "CO"],
  [820, 831, "WY"],
  [832, 838, "ID"],
  [840, 847, "UT"],
  [850, 865, "AZ"],
  [870, 884, "NM"],
  [885, 885, "TX"],
  [889, 898, "NV"],
  [900, 961, "CA"],
  [967, 968, "HI"],
  [970, 979, "OR"],
  [980, 994, "WA"],
  [995, 999, "AK"],
];

/** State for a US ZIP code (5 or 9 digits). Null for anything else. */
export function regionFromZip(zip: string | null | undefined): string | null {
  if (!zip) return null;
  const m = zip.trim().match(/^(\d{5})(?:-?\d{4})?$/);
  if (!m) return null;
  const prefix = Number(m[1].slice(0, 3));
  for (const [lo, hi, st] of ZIP_RANGES) {
    if (prefix >= lo && prefix <= hi) return STATES[st];
  }
  return null;
}

/** North American area codes → state (US + PR; Canada/Caribbean omitted). */
const AREA_CODES: Record<string, string> = {};
const areaCodesByState: Record<string, number[]> = {
  AL: [205, 251, 256, 334, 659, 938],
  AK: [907],
  AZ: [480, 520, 602, 623, 928],
  AR: [479, 501, 870],
  CA: [
    209, 213, 279, 310, 323, 341, 350, 369, 408, 415, 424, 442, 510, 530, 559,
    562, 619, 626, 628, 650, 657, 661, 669, 707, 714, 747, 760, 805, 818, 820,
    831, 840, 858, 909, 916, 925, 949, 951,
  ],
  CO: [303, 719, 720, 970, 983],
  CT: [203, 475, 860, 959],
  DE: [302],
  DC: [202, 771],
  FL: [
    239, 305, 321, 324, 352, 386, 407, 448, 561, 645, 656, 689, 727, 728, 754,
    772, 786, 813, 850, 863, 904, 941, 954,
  ],
  GA: [229, 404, 470, 478, 678, 706, 762, 770, 912, 943],
  HI: [808],
  ID: [208, 986],
  IL: [
    217, 224, 309, 312, 331, 447, 464, 618, 630, 708, 730, 773, 779, 815, 847,
    872,
  ],
  IN: [219, 260, 317, 463, 574, 765, 812, 930],
  IA: [319, 515, 563, 641, 712],
  KS: [316, 620, 785, 913],
  KY: [270, 364, 502, 606, 859],
  LA: [225, 318, 337, 504, 985],
  ME: [207],
  MD: [227, 240, 301, 410, 443, 667],
  MA: [339, 351, 413, 508, 617, 774, 781, 857, 978],
  MI: [231, 248, 269, 313, 517, 586, 616, 679, 734, 810, 906, 947, 989],
  MN: [218, 320, 507, 612, 651, 763, 924, 952],
  MS: [228, 471, 601, 662, 769],
  MO: [235, 314, 417, 557, 573, 636, 660, 816, 975],
  MT: [406],
  NE: [308, 402, 531],
  NV: [702, 725, 775],
  NH: [603],
  NJ: [201, 551, 609, 640, 732, 848, 856, 862, 908, 973],
  NM: [505, 575],
  NY: [
    212, 315, 329, 332, 347, 363, 516, 518, 585, 607, 624, 631, 646, 680, 716,
    718, 838, 845, 914, 917, 929, 934,
  ],
  NC: [252, 336, 472, 704, 743, 828, 910, 919, 980, 984],
  ND: [701],
  OH: [
    216, 220, 234, 283, 326, 330, 380, 419, 436, 440, 513, 567, 614, 740, 937,
  ],
  OK: [405, 539, 572, 580, 918],
  OR: [458, 503, 541, 971],
  PA: [
    215, 223, 267, 272, 412, 445, 484, 570, 582, 610, 717, 724, 814, 835, 878,
  ],
  RI: [401],
  SC: [803, 821, 839, 843, 854, 864],
  SD: [605],
  TN: [423, 615, 629, 731, 865, 901, 931],
  TX: [
    210, 214, 254, 281, 325, 346, 361, 409, 430, 432, 469, 512, 621, 682, 713,
    726, 737, 806, 817, 830, 832, 903, 915, 936, 940, 945, 956, 972, 979,
  ],
  UT: [385, 435, 801],
  VT: [802],
  VA: [276, 434, 540, 571, 686, 703, 757, 804, 826, 948],
  WA: [206, 253, 360, 425, 509, 564],
  WV: [304, 681],
  WI: [262, 274, 353, 414, 534, 608, 715, 920],
  WY: [307],
  PR: [787, 939],
};
for (const [st, codes] of Object.entries(areaCodesByState)) {
  for (const c of codes) AREA_CODES[String(c)] = STATES[st];
}

/**
 * State for a US phone number's area code. Accepts E.164 ("+12095551234"),
 * 10 digits, or formatted input; null when it isn't a US number or the area
 * code is unknown. Mobile numbers travel, so this is a weaker signal than a
 * ZIP or an explicit state.
 */
export function regionFromPhone(
  phone: string | null | undefined,
): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  let area: string | null = null;
  if (digits.length === 11 && digits.startsWith("1")) area = digits.slice(1, 4);
  else if (digits.length === 10) area = digits.slice(0, 3);
  return area ? (AREA_CODES[area] ?? null) : null;
}

export interface LeadRegionInput {
  /** A state the form asked for explicitly, or one already stored. */
  formState?: string | null;
  /** The city answer as typed — may carry a state suffix. */
  city?: string | null;
  zip?: string | null;
  /** The state the geocoder resolved the city to. */
  geocodedRegion?: string | null;
  phone?: string | null;
  /** The ad set's targeted state — the last resort. */
  adsetRegion?: string | null;
}

/** Pull a state answer out of a raw form payload, if the form asked for one. */
export function findFormState(
  formData: Record<string, unknown> | null | undefined,
): string | null {
  if (!formData) return null;
  for (const [key, value] of Object.entries(formData)) {
    const k = fold(key);
    if (
      (k === "state" || k === "estado" || k === "province" || k === "provincia" ||
        /\b(state|estado)\b/.test(k)) &&
      !/united states|estados unidos|state of|statement/.test(k) &&
      value
    ) {
      const region = normalizeRegion(String(value));
      if (region) return region;
    }
  }
  return null;
}

/** Best available state for the lead, or null when nothing resolves. */
export function resolveLeadRegion(input: LeadRegionInput): string | null {
  return (
    normalizeRegion(input.formState) ??
    splitCityRegion(input.city).region ??
    regionFromZip(input.zip) ??
    normalizeRegion(input.geocodedRegion) ??
    regionFromPhone(input.phone) ??
    normalizeRegion(input.adsetRegion) ??
    null
  );
}
