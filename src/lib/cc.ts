/**
 * Contractor Compliance sub-pipeline — the states a lead walks through while
 * its card sits in the "In Contractor Compliance" column. Defined by the ops
 * team (meeting 2026-08-21): the funnel is Activated → Next Steps Explained
 * (invited but never activated the account — chased every morning) →
 * Completing A1s (activated and completed at least one task — a valid driver
 * for the client) → Abandoned.
 */

export const CC_STATUSES = [
  "activated",
  "next_steps_explained",
  "completing_a1s",
  "abandoned",
] as const;

export type CcStatus = (typeof CC_STATUSES)[number];

export const CC_STATUS_LABEL: Record<CcStatus, string> = {
  activated: "CC Activated",
  next_steps_explained: "Next Steps Explained",
  completing_a1s: "Completing A1s",
  abandoned: "Abandoned",
};

/** Badge accents — amber for the chase list, green for valid drivers. */
export const CC_STATUS_COLOR: Record<CcStatus, string> = {
  activated: "#3b82f6",
  next_steps_explained: "#f59e0b",
  completing_a1s: "#22c55e",
  abandoned: "#94a3b8",
};

export function isCcStatus(v: unknown): v is CcStatus {
  return typeof v === "string" && (CC_STATUSES as readonly string[]).includes(v);
}
