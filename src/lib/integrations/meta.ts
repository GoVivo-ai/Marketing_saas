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

const GRAPH = "https://graph.facebook.com/v23.0";

interface GraphPage<T> {
  data: T[];
  paging?: { next?: string };
}

async function graphGet<T>(url: string, token: string): Promise<GraphPage<T>> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    // Insights are not real-time; let Next cache identical calls briefly.
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    const body = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    throw new ConnectorError("meta", `${res.status} ${body.slice(0, 300)}`, retryable);
  }
  return res.json();
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
        leads: action("lead") + action("onsite_conversion.lead_grouped"),
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
      campaign?: { id: string; name?: string; status?: string; objective?: string };
    };
    const ads = await graphGetAll<AdRow>(
      `${GRAPH}/${creds.accountId}/ads?fields=id,campaign_id,campaign{id,name,status,objective}&limit=200`,
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
        all.push({
          externalId: r.id,
          campaignExternalId: ad.campaign_id ?? ad.campaign?.id,
          campaignName: ad.campaign?.name,
          campaignStatus: ad.campaign?.status,
          campaignObjective: ad.campaign?.objective,
          createdAt: r.created_time,
          name: field("name") ?? field("nombre"),
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
