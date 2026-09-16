/**
 * Delivery status — what Ads Manager shows in its "Delivery" column.
 *
 * The configured status (`ACTIVE`/`PAUSED`) only says whether someone flipped
 * the switch on; it doesn't say whether the ad set is actually spending. Meta
 * answers that with three fields together: `effective_status` (the switch plus
 * every inherited/review state), `learning_stage_info.status` (whether the
 * delivery system still needs conversions to stabilise) and the end of the
 * schedule. This collapses them into the one label the ops team reads.
 */

export type DeliveryTone = "active" | "learning" | "off" | "issue";

export interface Delivery {
  label: string;
  tone: DeliveryTone;
  /** Longer explanation for the cell's tooltip. */
  hint: string;
}

/** Ads Manager treats a schedule that already ended as "Completed", not "Off". */
function hasEnded(endTime: Date | null): boolean {
  return endTime != null && endTime.getTime() <= Date.now();
}

/**
 * @param effectiveStatus Meta `effective_status` (falls back to the configured
 *   status on rows synced before delivery was tracked).
 * @param learningStage Meta `learning_stage_info.status`.
 */
export function deliveryStatus(
  effectiveStatus: string | null,
  learningStage: string | null,
  endTime: Date | null,
): Delivery {
  const status = (effectiveStatus ?? "").toUpperCase();

  switch (status) {
    case "ACTIVE": {
      if (hasEnded(endTime))
        return {
          label: "Completed",
          tone: "off",
          hint: "The schedule ended — it ran and is no longer delivering.",
        };
      const stage = (learningStage ?? "").toUpperCase();
      if (stage === "LEARNING")
        return {
          label: "In learning",
          tone: "learning",
          hint: "Meta is still learning who to show this to — performance isn't stable yet.",
        };
      if (stage === "LEARNING_LIMITED")
        return {
          label: "Learning limited",
          tone: "issue",
          hint: "It left learning without enough conversions — the audience or budget is too small.",
        };
      return { label: "Active", tone: "active", hint: "Delivering normally." };
    }
    case "PAUSED":
      return { label: "Paused", tone: "off", hint: "Turned off here." };
    case "CAMPAIGN_PAUSED":
      return {
        label: "Campaign off",
        tone: "off",
        hint: "On, but its campaign is paused — so nothing delivers.",
      };
    case "ADSET_PAUSED":
      return {
        label: "Ad set off",
        tone: "off",
        hint: "On, but its ad set is paused — so nothing delivers.",
      };
    case "ARCHIVED":
    case "DELETED":
      return { label: "Archived", tone: "off", hint: "Archived in Ads Manager." };
    case "IN_PROCESS":
    case "PENDING_REVIEW":
      return {
        label: "In review",
        tone: "learning",
        hint: "Waiting on Meta's review before it can deliver.",
      };
    case "WITH_ISSUES":
    case "DISAPPROVED":
      return {
        label: "With issues",
        tone: "issue",
        hint: "Meta flagged it — check Ads Manager for the rejection reason.",
      };
    case "PENDING_BILLING_INFO":
      return {
        label: "Billing issue",
        tone: "issue",
        hint: "The ad account is missing valid billing info.",
      };
    case "":
      return { label: "—", tone: "off", hint: "Not synced yet." };
    default:
      // Meta keeps adding statuses; show the raw one rather than hiding it.
      return {
        label: status.replaceAll("_", " ").toLowerCase(),
        tone: "off",
        hint: `Meta reports this as ${status}.`,
      };
  }
}

/** True when the ad set is actually spending right now. */
export function isDelivering(d: Delivery): boolean {
  return d.tone === "active" || d.tone === "learning";
}
