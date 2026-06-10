import { MarketingConnector, Platform } from "./types";
import { metaConnector } from "./meta";
import { googleAdsConnector } from "./google-ads";

const registry: Partial<Record<Platform, MarketingConnector>> = {
  meta: metaConnector,
  google_ads: googleAdsConnector,
};

export function getConnector(platform: Platform): MarketingConnector {
  const connector = registry[platform];
  if (!connector) {
    throw new Error(`No connector registered for platform "${platform}"`);
  }
  return connector;
}

export * from "./types";
