import {
  ConnectorCredentials,
  ConnectorError,
  DateRange,
  MarketingConnector,
} from "./types";

/**
 * Google Ads connector — Phase 2.
 *
 * Implementation plan:
 *  - OAuth2 with offline access; refresh tokens stored encrypted per workspace.
 *  - GAQL via the REST endpoint `customers/{id}/googleAds:searchStream`:
 *      campaigns:  SELECT campaign.id, campaign.name, campaign.status …
 *      metrics:    SELECT segments.date, metrics.cost_micros, metrics.clicks,
 *                  metrics.impressions, metrics.conversions …
 *  - Lead Form assets via asset queries.
 */
export const googleAdsConnector: MarketingConnector = {
  platform: "google_ads",

  async listAccounts(_creds: ConnectorCredentials) {
    throw new ConnectorError("google_ads", "Not implemented yet (Phase 2)");
  },
  async listCampaigns(_creds: ConnectorCredentials) {
    throw new ConnectorError("google_ads", "Not implemented yet (Phase 2)");
  },
  async fetchDailyMetrics(_creds: ConnectorCredentials, _range: DateRange) {
    throw new ConnectorError("google_ads", "Not implemented yet (Phase 2)");
  },
  async fetchLeads(_creds: ConnectorCredentials, _range: DateRange) {
    throw new ConnectorError("google_ads", "Not implemented yet (Phase 2)");
  },
};
