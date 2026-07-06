import { MarketingConnector, Platform } from "./types";
import { metaConnector } from "./meta";
import { googleAdsConnector } from "./google-ads";

const registry: Partial<Record<Platform, MarketingConnector>> = {
  meta: metaConnector,
  google_ads: googleAdsConnector,
};

// Accepts any platform value from the DB enum ("manual" included) and
// throws for the ones that have no ad-platform connector.
export function getConnector(platform: string): MarketingConnector {
  const connector = registry[platform as Platform];
  if (!connector) {
    throw new Error(`No connector registered for platform "${platform}"`);
  }
  return connector;
}

export * from "./types";
