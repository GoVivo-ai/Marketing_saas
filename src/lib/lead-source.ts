/**
 * Where a lead came from — the acquisition channel, not the ad platform.
 *
 * Until now the channel was implied by `leads.platform`, which only ever said
 * "meta" or "manual". That collapsed two very different leads into one label:
 * someone who filled in the client's own site and someone an agent typed in
 * off a phone call. The team reads those differently and the AI scores them
 * differently — a website lead came looking for us — so the channel is stored
 * explicitly.
 */

export const LEAD_SOURCES = [
  "meta_ads",
  "google_ads",
  "tiktok_ads",
  "linkedin_ads",
  "website",
  "hiring_portal",
  "manual",
] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  tiktok_ads: "TikTok Ads",
  linkedin_ads: "LinkedIn Ads",
  website: "Website",
  hiring_portal: "Hiring portal",
  manual: "Manual",
};

/** The channels a lead can actually arrive through today. */
export const ACTIVE_LEAD_SOURCES: LeadSource[] = ["meta_ads", "website", "hiring_portal", "manual"];

export function leadSourceLabel(source: string | null): string {
  return LEAD_SOURCE_LABELS[source as LeadSource] ?? "Unknown";
}

export function isLeadSource(value: string | null): value is LeadSource {
  return LEAD_SOURCES.includes(value as LeadSource);
}

/**
 * Derives the channel for a lead that predates the column (or for any row
 * written without one). Hand-entered leads carry `formData.source` —
 * "public_form" marks the shareable /join form, which is a website capture;
 * anything else was typed in by an agent.
 */
export function deriveLeadSource(
  platform: string,
  formData: Record<string, unknown> | null | undefined,
): LeadSource {
  switch (platform) {
    case "meta":
      return "meta_ads";
    case "google_ads":
      return "google_ads";
    case "tiktok":
      return "tiktok_ads";
    case "linkedin":
      return "linkedin_ads";
    default:
      return formData?.source === "public_form" ? "website" : "manual";
  }
}

/**
 * How much the channel itself says about a lead, for the AI scorer.
 *
 * A website lead navigated to the client's own site and asked to be
 * contacted; a Meta lead tapped a form inside a feed they were scrolling.
 * Same answers, different intent — so the channel is part of the score.
 */
export const LEAD_SOURCE_INTENT: Record<LeadSource, string> = {
  website: "came to the client's own website and asked to be contacted — the strongest intent signal available",
  meta_ads: "filled in a lead form inside the Facebook/Instagram feed — convenient to submit, so intent is weaker",
  google_ads: "clicked a search ad, so they were actively looking",
  tiktok_ads: "filled in a lead form inside the TikTok feed — weak intent",
  linkedin_ads: "filled in a lead form on LinkedIn",
  hiring_portal: "submitted a full job application on the client's own hiring portal, unprompted — high intent, and more effort than a short lead form",
  manual: "was entered by the team (a referral or a phone call), so intent is only as good as that conversation",
};
