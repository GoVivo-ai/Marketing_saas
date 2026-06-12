/**
 * Platform-agnostic contracts for ad platform connectors.
 *
 * Every platform (Meta, Google Ads, TikTok, LinkedIn…) implements
 * `MarketingConnector` and returns data already normalized into these
 * shapes, so the sync engine, the dashboard and the AI layer never need
 * to know platform-specific details.
 */

export type Platform = "meta" | "google_ads" | "tiktok" | "linkedin";

export interface ConnectorCredentials {
  accessToken: string;
  refreshToken?: string;
  accountId: string;
}

export interface NormalizedAccount {
  externalId: string;
  name: string;
  currency: string;
}

export interface NormalizedCampaign {
  externalId: string;
  name: string;
  status: string;
  objective?: string;
  dailyBudget?: number;
}

export interface NormalizedDailyMetrics {
  campaignExternalId: string;
  date: string; // YYYY-MM-DD
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  conversions: number;
  extra?: Record<string, unknown>;
}

export interface NormalizedLead {
  externalId: string;
  campaignExternalId?: string;
  /** Ad set the lead came from — carries the audience-location radius. */
  adsetExternalId?: string;
  /**
   * Campaign details carried with the lead so the sync can link (and, if
   * needed, create) the campaign even when it's archived/deleted and absent
   * from the account-level campaign listing.
   */
  campaignName?: string;
  campaignStatus?: string;
  campaignObjective?: string;
  createdAt: string; // ISO timestamp
  name?: string;
  email?: string;
  phone?: string;
  formData?: Record<string, unknown>;
}

export interface DateRange {
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
}

export interface MarketingConnector {
  readonly platform: Platform;

  /** Ad accounts the credential can read. */
  listAccounts(creds: ConnectorCredentials): Promise<NormalizedAccount[]>;

  /** All campaigns in the account. */
  listCampaigns(creds: ConnectorCredentials): Promise<NormalizedCampaign[]>;

  /** Daily campaign-level performance for the range (inclusive). */
  fetchDailyMetrics(
    creds: ConnectorCredentials,
    range: DateRange,
  ): Promise<NormalizedDailyMetrics[]>;

  /** Leads captured by lead forms in the range. */
  fetchLeads(creds: ConnectorCredentials, range: DateRange): Promise<NormalizedLead[]>;
}

export class ConnectorError extends Error {
  constructor(
    public readonly platform: Platform,
    message: string,
    public readonly retryable = false,
  ) {
    super(`[${platform}] ${message}`);
  }
}
