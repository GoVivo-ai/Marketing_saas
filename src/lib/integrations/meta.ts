import {
  ConnectorCredentials,
  ConnectorError,
  DateRange,
  MarketingConnector,
  NormalizedAccount,
  NormalizedCampaign,
  NormalizedDailyMetrics,
  NormalizedLead,
} from "./types";
import { US_STATES } from "@/lib/us-states";

const GRAPH = "https://graph.facebook.com/v23.0";

interface GraphPage<T> {
  data: T[];
  paging?: { next?: string };
}

// Meta's Graph API regularly returns transient 500s (code 2,
// is_transient:true — "An unexpected error has occurred. Please retry") and
// 429 rate limits. Both are safe to retry; back off and try a few times before
// surfacing the failure to the caller.
const MAX_RETRIES = 4;

async function graphGet<T>(url: string, token: string): Promise<GraphPage<T>> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      // Insights are not real-time; let Next cache identical calls briefly.
      next: { revalidate: 300 },
    });
    if (res.ok) return res.json();

    const body = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < MAX_RETRIES) {
      // Exponential backoff with jitter: ~0.5s, 1s, 2s, 4s.
      const delay = 500 * 2 ** attempt + Math.floor(Math.random() * 250);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    throw new ConnectorError("meta", `${res.status} ${body.slice(0, 300)}`, retryable);
  }
}

/** Follows Graph API cursor pagination until exhausted. */
async function graphGetAll<T>(firstUrl: string, token: string): Promise<T[]> {
  const out: T[] = [];
  let url: string | undefined = firstUrl;
  while (url) {
    const page: GraphPage<T> = await graphGet<T>(url, token);
    out.push(...page.data);
    url = page.paging?.next;
  }
  return out;
}

// By default Meta's /ads edge only returns ACTIVE/PAUSED ads, so leads from
// archived ads (and their campaigns) were never fetched. Request every
// status explicitly so those leads can still be pulled and attributed.
// Note: "DELETED" is rejected by this edge ("cannot request deleted
// objects"), so we request every non-deleted status — crucially ARCHIVED,
// which holds the bulk of historical leads.
const AD_STATUSES = encodeURIComponent(
  JSON.stringify([
    "ACTIVE",
    "PAUSED",
    "ARCHIVED",
    "ADSET_PAUSED",
    "CAMPAIGN_PAUSED",
    "DISAPPROVED",
    "PENDING_REVIEW",
    "PREAPPROVED",
    "PENDING_BILLING_INFO",
    "IN_PROCESS",
    "WITH_ISSUES",
  ]),
);

/**
 * Meta (Facebook + Instagram) Marketing API connector.
 *
 * Required token scopes: ads_read, leads_retrieval.
 * Account ids are passed in the `act_<id>` form Meta expects.
 */
export const metaConnector: MarketingConnector = {
  platform: "meta",

  async listAccounts(creds: ConnectorCredentials): Promise<NormalizedAccount[]> {
    type Row = { id: string; name: string; currency: string };
    const rows = await graphGetAll<Row>(
      `${GRAPH}/me/adaccounts?fields=id,name,currency&limit=100`,
      creds.accessToken,
    );
    return rows.map((r) => ({ externalId: r.id, name: r.name, currency: r.currency }));
  },

  async listCampaigns(creds: ConnectorCredentials): Promise<NormalizedCampaign[]> {
    type Row = {
      id: string;
      name: string;
      status: string;
      objective?: string;
      daily_budget?: string;
    };
    const rows = await graphGetAll<Row>(
      `${GRAPH}/${creds.accountId}/campaigns?fields=id,name,status,objective,daily_budget&limit=100`,
      creds.accessToken,
    );
    return rows.map((r) => ({
      externalId: r.id,
      name: r.name,
      status: r.status,
      objective: r.objective,
      // Meta returns budgets in minor units (cents).
      dailyBudget: r.daily_budget ? Number(r.daily_budget) / 100 : undefined,
    }));
  },

  async fetchDailyMetrics(
    creds: ConnectorCredentials,
    range: DateRange,
  ): Promise<NormalizedDailyMetrics[]> {
    type Row = {
      campaign_id: string;
      date_start: string;
      spend?: string;
      impressions?: string;
      clicks?: string;
      reach?: string;
      frequency?: string;
      actions?: { action_type: string; value: string }[];
    };
    const timeRange = encodeURIComponent(
      JSON.stringify({ since: range.since, until: range.until }),
    );
    const rows = await graphGetAll<Row>(
      `${GRAPH}/${creds.accountId}/insights` +
        `?level=campaign&time_increment=1&time_range=${timeRange}` +
        `&fields=campaign_id,spend,impressions,clicks,reach,frequency,actions&limit=500`,
      creds.accessToken,
    );
    return rows.map((r) => {
      const action = (type: string) =>
        Number(r.actions?.find((a) => a.action_type === type)?.value ?? 0);
      return {
        campaignExternalId: r.campaign_id,
        date: r.date_start,
        spend: Number(r.spend ?? 0),
        impressions: Number(r.impressions ?? 0),
        clicks: Number(r.clicks ?? 0),
        // Meta reports the SAME lead under multiple action_types: the
        // canonical `lead` (what Ads Manager shows as "Results/Leads") and
        // duplicate mirrors like `onsite_conversion.lead_grouped`. Summing
        // them double-counts every lead. Use `lead` as the source of truth,
        // falling back to the grouped on-Meta count only when `lead` is absent.
        leads: action("lead") || action("onsite_conversion.lead_grouped"),
        conversions: action("offsite_conversion.fb_pixel_purchase"),
        extra: { reach: Number(r.reach ?? 0), frequency: Number(r.frequency ?? 0) },
      };
    });
  },

  async fetchLeads(
    creds: ConnectorCredentials,
    range: DateRange,
  ): Promise<NormalizedLead[]> {
    // 1) Lead-gen forms live under ads; fetch ads with their parent campaign.
    // We expand `campaign{…}` so each lead carries its campaign details even
    // when that campaign is archived/deleted (and thus missing from the
    // account-level campaign listing).
    type AdRow = {
      id: string;
      campaign_id?: string;
      adset_id?: string;
      campaign?: { id: string; name?: string; status?: string; objective?: string };
    };
    const ads = await graphGetAll<AdRow>(
      `${GRAPH}/${creds.accountId}/ads?fields=id,campaign_id,adset_id,campaign{id,name,status,objective}` +
        `&effective_status=${AD_STATUSES}&limit=200`,
      creds.accessToken,
    );

    // 2) Pull leads per ad, filtered by creation time.
    type LeadRow = {
      id: string;
      created_time: string;
      field_data?: { name: string; values: string[] }[];
    };
    const sinceTs = Math.floor(new Date(range.since).getTime() / 1000);
    const untilTs = Math.floor(new Date(`${range.until}T23:59:59Z`).getTime() / 1000);
    const filtering = encodeURIComponent(
      JSON.stringify([
        { field: "time_created", operator: "GREATER_THAN", value: sinceTs },
        { field: "time_created", operator: "LESS_THAN", value: untilTs },
      ]),
    );

    const all: NormalizedLead[] = [];
    for (const ad of ads) {
      const rows = await graphGetAll<LeadRow>(
        `${GRAPH}/${ad.id}/leads?fields=id,created_time,field_data&filtering=${filtering}&limit=200`,
        creds.accessToken,
      );
      for (const r of rows) {
        const field = (key: string) =>
          r.field_data?.find((f) => f.name.toLowerCase().includes(key))?.values?.[0];
        const exact = (key: string) =>
          r.field_data?.find((f) => f.name.toLowerCase() === key)?.values?.[0];
        // Forms split the name (nombre/apellido or first/last) — join them.
        const firstName = exact("first_name") ?? exact("nombre");
        const lastName = exact("last_name") ?? exact("apellido");
        const fullName =
          exact("full_name") ??
          ([firstName, lastName].filter(Boolean).join(" ") ||
            (field("name") ?? field("nombre")));
        all.push({
          externalId: r.id,
          campaignExternalId: ad.campaign_id ?? ad.campaign?.id,
          adsetExternalId: ad.adset_id,
          campaignName: ad.campaign?.name,
          campaignStatus: ad.campaign?.status,
          campaignObjective: ad.campaign?.objective,
          createdAt: r.created_time,
          name: fullName,
          email: field("email"),
          phone: field("phone") ?? field("tel"),
          formData: Object.fromEntries(
            (r.field_data ?? []).map((f) => [f.name, f.values.join(", ")]),
          ),
        });
      }
    }
    return all;
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Ad-set level fetchers (Meta-specific — not part of the cross-platform
// connector interface). Ad sets carry the audience-location targeting we plot
// on the campaign map, plus one-level-deeper performance metrics.
// ─────────────────────────────────────────────────────────────────────────

export interface NormalizedAdSet {
  externalId: string;
  campaignExternalId: string;
  name: string;
  status: string;
  /** First targeted city (Meta allows several, but geo-per-city accounts use one). */
  city?: {
    name: string;
    region?: string;
    country?: string;
    radius?: number;
    distanceUnit?: string;
    /** Exact pin for custom-location targeting — skips geocoding when set. */
    lat?: number;
    lng?: number;
  };
}

export interface NormalizedAdSetMetrics {
  adsetExternalId: string;
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  conversions: number;
  extra: { reach: number; frequency: number };
}

// Non-deleted statuses, so paused/archived ad sets (and their targeting +
// historical metrics) are still pulled — mirrors the leads fetch above.
const ADSET_STATUSES = encodeURIComponent(
  JSON.stringify([
    "ACTIVE",
    "PAUSED",
    "ARCHIVED",
    "CAMPAIGN_PAUSED",
    "WITH_ISSUES",
  ]),
);

type AdSetCity = {
  name: string;
  region?: string;
  country?: string;
  radius?: number;
  distance_unit?: string;
  /** Present on candidates built from custom-location pins. */
  lat?: number;
  lng?: number;
};

// Custom-location pins and zip codes don't carry a city name — only a
// `primary_city_id` key into Meta's geo database. This resolves those keys
// to their city name + region in one batched call.
async function resolveCityKeys(
  creds: ConnectorCredentials,
  keys: number[],
): Promise<Map<number, { name: string; region?: string }>> {
  const out = new Map<number, { name: string; region?: string }>();
  type Meta = { data?: { cities?: Record<string, { name: string; region?: string }> } };
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    const res = await graphGet<never>(
      `${GRAPH}/search?type=adgeolocationmeta&cities=${encodeURIComponent(JSON.stringify(chunk))}`,
      creds.accessToken,
    ) as unknown as Meta;
    for (const [key, c] of Object.entries(res.data?.cities ?? {})) {
      // Meta disambiguates duplicates as "Thousand Oaks (California)" —
      // strip the parenthetical so names match the plain city-targeting form.
      out.set(Number(key), {
        name: c.name.replace(/\s*\([^)]*\)\s*$/, ""),
        region: c.region,
      });
    }
  }
  return out;
}

// Strip accents/punctuation and lowercase so "Redondo Beach" matches a city
// named "redondo beach" regardless of how either side is cased or spelled.
function normalizeCity(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cityMatchesAdSetName(adSetName: string, cityName: string): boolean {
  const name = normalizeCity(adSetName);
  const city = normalizeCity(cityName);
  return city.length > 0 && (name.includes(city) || city.includes(name));
}

// Geo-per-city accounts name each ad set after its city. Pick the targeted city
// whose name the ad set name contains (or vice-versa); fall back to the first
// targeted city when nothing matches.
function pickCityForAdSet(
  adSetName: string,
  cities: AdSetCity[] | undefined,
): AdSetCity | undefined {
  if (!cities || cities.length === 0) return undefined;
  if (cities.length === 1) return cities[0];
  return cities.find((c) => cityMatchesAdSetName(adSetName, c.name)) ?? cities[0];
}

const STATE_NAME_BY_CODE = new Map(US_STATES.map((s) => [s.code, s.name]));

// These accounts name ad sets "<City>, <ST>_<suffix>" ("Las Vegas, NV_Jul").
// Used when pin/zip targeting resolves to a neighbouring primary city (a
// Las Vegas pin can land in "Sunrise Manor") — the name states the intent.
function parseCityFromAdSetName(
  adSetName: string,
): { name: string; region: string } | null {
  const m = adSetName.match(/^(.+?),\s*([A-Z]{2})(?:[_\s]|$)/);
  if (!m) return null;
  const region = STATE_NAME_BY_CODE.get(m[2]);
  return region ? { name: m[1].trim(), region } : null;
}

export async function listAdSets(
  creds: ConnectorCredentials,
): Promise<NormalizedAdSet[]> {
  type City = AdSetCity;
  type CustomLocation = {
    latitude?: number;
    longitude?: number;
    radius?: number;
    distance_unit?: string;
    primary_city_id?: number;
    country?: string;
  };
  type Zip = { key: string; primary_city_id?: number; country?: string };
  type Row = {
    id: string;
    name: string;
    status: string;
    campaign_id: string;
    targeting?: {
      geo_locations?: {
        cities?: City[];
        custom_locations?: CustomLocation[];
        zips?: Zip[];
      };
    };
  };
  const rows = await graphGetAll<Row>(
    `${GRAPH}/${creds.accountId}/adsets` +
      `?fields=id,name,status,campaign_id,targeting{geo_locations}` +
      `&effective_status=${ADSET_STATUSES}&limit=200`,
    creds.accessToken,
  );

  // Custom-location pins and zips reference cities by key only — resolve every
  // key that ad sets without city targeting need, in one batched lookup.
  const cityKeys = new Set<number>();
  for (const r of rows) {
    const g = r.targeting?.geo_locations;
    if (!g || g.cities?.length) continue;
    for (const l of g.custom_locations ?? [])
      if (l.primary_city_id) cityKeys.add(l.primary_city_id);
    for (const z of g.zips ?? [])
      if (z.primary_city_id) cityKeys.add(z.primary_city_id);
  }
  const cityByKey = cityKeys.size
    ? await resolveCityKeys(creds, [...cityKeys])
    : new Map<number, { name: string; region?: string }>();

  return rows.map((r) => {
    // These are geo-per-city accounts: each ad set ("conjunto") is named after
    // the one city it's meant to represent. Meta returns the targeted cities in
    // an arbitrary order, so cities[0] can be a neighbouring city (e.g. "Carson"
    // for a "Redondo Beach" ad set). Prefer the targeted city whose name the ad
    // set is named after; only fall back to the first city when none matches.
    const g = r.targeting?.geo_locations;
    let c = pickCityForAdSet(r.name, g?.cities);
    if (!c && g) {
      // No city targeting — build candidates from custom-location pins (exact
      // lat/lng, radius) and zip codes, both resolved via their primary city.
      const seen = new Set<number>();
      const candidates: AdSetCity[] = [];
      for (const l of g.custom_locations ?? []) {
        const meta = l.primary_city_id ? cityByKey.get(l.primary_city_id) : undefined;
        if (!meta || seen.has(l.primary_city_id!)) continue;
        seen.add(l.primary_city_id!);
        candidates.push({
          name: meta.name,
          region: meta.region,
          country: l.country,
          radius: l.radius,
          distance_unit: l.distance_unit,
          lat: l.latitude,
          lng: l.longitude,
        });
      }
      for (const z of g.zips ?? []) {
        const meta = z.primary_city_id ? cityByKey.get(z.primary_city_id) : undefined;
        if (!meta || seen.has(z.primary_city_id!)) continue;
        seen.add(z.primary_city_id!);
        candidates.push({ name: meta.name, region: meta.region, country: z.country });
      }
      c = candidates.find((cand) => cityMatchesAdSetName(r.name, cand.name));
      if (!c) {
        // Pins resolve to whichever city the pin lands in ("Sunrise Manor"
        // for a Las Vegas pin) — the ad set's own name states the intended
        // city, so prefer it and keep the pin's geometry.
        const parsed = parseCityFromAdSetName(r.name);
        c = parsed && candidates[0]
          ? { ...candidates[0], name: parsed.name, region: parsed.region }
          : (parsed ?? candidates[0]);
      }
    }
    return {
      externalId: r.id,
      campaignExternalId: r.campaign_id,
      name: r.name,
      status: r.status,
      city: c
        ? {
            name: c.name,
            region: c.region,
            country: c.country,
            radius: c.radius,
            distanceUnit: c.distance_unit,
            lat: c.lat,
            lng: c.lng,
          }
        : undefined,
    };
  });
}

export async function fetchAdSetDailyMetrics(
  creds: ConnectorCredentials,
  range: DateRange,
): Promise<NormalizedAdSetMetrics[]> {
  type Row = {
    adset_id: string;
    date_start: string;
    spend?: string;
    impressions?: string;
    clicks?: string;
    reach?: string;
    frequency?: string;
    actions?: { action_type: string; value: string }[];
  };
  const timeRange = encodeURIComponent(
    JSON.stringify({ since: range.since, until: range.until }),
  );
  const rows = await graphGetAll<Row>(
    `${GRAPH}/${creds.accountId}/insights` +
      `?level=adset&time_increment=1&time_range=${timeRange}` +
      `&fields=adset_id,spend,impressions,clicks,reach,frequency,actions&limit=500`,
    creds.accessToken,
  );
  return rows.map((r) => {
    const action = (type: string) =>
      Number(r.actions?.find((a) => a.action_type === type)?.value ?? 0);
    return {
      adsetExternalId: r.adset_id,
      date: r.date_start,
      spend: Number(r.spend ?? 0),
      impressions: Number(r.impressions ?? 0),
      clicks: Number(r.clicks ?? 0),
      // Same lead de-dup as campaign metrics: never sum mirrored action types.
      leads: action("lead") || action("onsite_conversion.lead_grouped"),
      conversions: action("offsite_conversion.fb_pixel_purchase"),
      extra: { reach: Number(r.reach ?? 0), frequency: Number(r.frequency ?? 0) },
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Lead-gen form questions — the CURRENT form definition, straight from the
// ads' creatives. Lead formData only reflects past submissions, so when the
// operator edits the form on Meta this is the only way to surface the new
// questions (and drop removed ones) before fresh leads arrive.
// ─────────────────────────────────────────────────────────────────────────

export interface LeadFormQuestion {
  key: string;
  /** Question text as the lead sees it. */
  label?: string;
  type?: string;
}

/**
 * Lead-gen form questions per campaign (keyed by campaign external id).
 * Walks the account's ads, pulls the form id from each creative's
 * call-to-action, then fetches each unique form's questions once.
 */
export async function fetchLeadFormQuestions(
  creds: ConnectorCredentials,
): Promise<Map<string, LeadFormQuestion[]>> {
  type Cta = { value?: { lead_gen_form_id?: string } };
  type AdRow = {
    id: string;
    campaign_id?: string;
    creative?: {
      // Classic creatives: one CTA under the story spec's link/video data.
      object_story_spec?: {
        link_data?: { call_to_action?: Cta };
        video_data?: { call_to_action?: Cta };
      };
      // Flexible/Advantage+ creatives: CTAs live in the asset feed instead.
      asset_feed_spec?: { call_to_actions?: Cta[] };
    };
  };
  const ads = await graphGetAll<AdRow>(
    `${GRAPH}/${creds.accountId}/ads?fields=id,campaign_id,creative{object_story_spec,asset_feed_spec}` +
      `&effective_status=${AD_STATUSES}&limit=200`,
    creds.accessToken,
  );

  const formIdsByCampaign = new Map<string, Set<string>>();
  for (const ad of ads) {
    if (!ad.campaign_id) continue;
    const spec = ad.creative?.object_story_spec;
    const formIds = [
      spec?.link_data?.call_to_action?.value?.lead_gen_form_id,
      spec?.video_data?.call_to_action?.value?.lead_gen_form_id,
      ...(ad.creative?.asset_feed_spec?.call_to_actions ?? []).map(
        (c) => c.value?.lead_gen_form_id,
      ),
    ].filter((id): id is string => Boolean(id));
    if (!formIds.length) continue;
    const set = formIdsByCampaign.get(ad.campaign_id) ?? new Set<string>();
    for (const id of formIds) set.add(id);
    formIdsByCampaign.set(ad.campaign_id, set);
  }

  // Fetch each unique form once (campaigns commonly share a form).
  type Form = { questions?: { key?: string; label?: string; type?: string }[] };
  const questionsByForm = new Map<string, LeadFormQuestion[]>();
  const uniqueFormIds = new Set([...formIdsByCampaign.values()].flatMap((s) => [...s]));
  for (const formId of uniqueFormIds) {
    try {
      const form = (await graphGet<never>(
        `${GRAPH}/${formId}?fields=questions`,
        creds.accessToken,
      )) as unknown as Form;
      questionsByForm.set(
        formId,
        (form.questions ?? [])
          .filter((q) => q.key)
          .map((q) => ({ key: q.key!, label: q.label, type: q.type })),
      );
    } catch {
      // A single unreadable form (deleted, permission gap) shouldn't sink
      // the rest — campaigns using it just keep their previous questions.
    }
  }

  const out = new Map<string, LeadFormQuestion[]>();
  for (const [campaignId, formIds] of formIdsByCampaign) {
    const seen = new Set<string>();
    const questions: LeadFormQuestion[] = [];
    for (const formId of formIds) {
      for (const q of questionsByForm.get(formId) ?? []) {
        if (seen.has(q.key)) continue;
        seen.add(q.key);
        questions.push(q);
      }
    }
    if (questions.length) out.set(campaignId, questions);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Targeting search — Meta's own geo database, so picked city names match
// the ad-set targeting names that sync writes (and actuals join on).
// ─────────────────────────────────────────────────────────────────────────

export interface GeoCitySuggestion {
  /** Meta's targeting key for the city. */
  key: string;
  name: string;
  /** Full region/state name, e.g. "Florida". */
  region: string | null;
  countryCode: string | null;
}

/** Type-ahead city search against Meta's ad geo targeting database. */
export async function searchGeoCities(
  accessToken: string,
  q: string,
  countryCode = "US",
): Promise<GeoCitySuggestion[]> {
  type Row = {
    key: string;
    name: string;
    region?: string;
    country_code?: string;
  };
  const params = new URLSearchParams({
    type: "adgeolocation",
    location_types: JSON.stringify(["city"]),
    q,
    country_code: countryCode,
    limit: "25",
  });
  const page = await graphGet<Row>(`${GRAPH}/search?${params}`, accessToken);
  return page.data.map((r) => ({
    key: r.key,
    name: r.name,
    region: r.region ?? null,
    countryCode: r.country_code ?? null,
  }));
}
