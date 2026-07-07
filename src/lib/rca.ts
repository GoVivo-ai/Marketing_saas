/**
 * RCA (Root-Cause Analysis) disqualification taxonomy.
 *
 * Ported from VIVO's operational spreadsheet (the "RCA_Dictionary" tab) so the
 * app captures *why* a lead was lost/not-qualified with the same three-level
 * vocabulary the ops team already uses — Level 1 (who/what drove it) → Level 2
 * (category) → Level 3 (specific reason). This is shared ops config, not client
 * data, so it lives in code as the default taxonomy for every workspace.
 */
export const RCA_TAXONOMY = {
  "Agent Driven": {
    Contactability: [
      "No contact after multiple attempts",
      "VM full or inactive",
      "Phone not working or disconnected",
      "Wrong number - email sent to confirm",
    ],
    "Process / Follow-up": [
      "No answer",
      "Profile created - Next Steps Explained",
      "Requested a callback",
      "Requested info by email / SMS",
      "Other - See detailed notes",
      "Email Sent / SMS Sent",
    ],
    "Lead quality / Data": ["Invalid email / Email bounced"],
  },
  "Candidate Driven": {
    "Interest / Decision": [
      "Contacted - Interested",
      "Contacted - No Interested",
      "Contacted - No Interested (Payment)",
      "Contacted - No Interested (Schedule)",
      "Contacted – Thinking about it / To decide",
      "Lead will call back",
    ],
    "Eligibility – Vehicle": [
      "Vehicle too old / Does not meet vehicle year",
      "No vehicle currently",
    ],
    "Location / Coverage": ["Out of area / Too far"],
    "Availability / Schedule": ["Schedule conflict with ops"],
    "Lead quality / Data": [
      "Lead does not remember applying",
      "Language barrier",
    ],
    "Eligibility – Criminal Record": ["Criminal Record"],
    "Eligibility - Limited fit": [
      "Not aligned with our organizational values",
    ],
    "Process / Follow-up": ["Profile created - Completing A1s"],
  },
} as const satisfies Record<string, Record<string, readonly string[]>>;

export type RcaLevel1 = keyof typeof RCA_TAXONOMY;

export const RCA_LEVEL1: readonly RcaLevel1[] = Object.keys(
  RCA_TAXONOMY,
) as RcaLevel1[];

/** Level-2 categories under a given Level-1, or [] if l1 is unknown. */
export function rcaLevel2(l1: string): string[] {
  const branch = RCA_TAXONOMY[l1 as RcaLevel1];
  return branch ? Object.keys(branch) : [];
}

/** Level-3 reasons under a given l1 → l2, or [] if either is unknown. */
export function rcaLevel3(l1: string, l2: string): string[] {
  const branch = RCA_TAXONOMY[l1 as RcaLevel1] as
    | Record<string, readonly string[]>
    | undefined;
  return branch && branch[l2] ? [...branch[l2]] : [];
}

/** Validates a full l1 → l2 → l3 path against the taxonomy. */
export function isValidRcaPath(l1: string, l2: string, l3: string): boolean {
  return rcaLevel3(l1, l2).includes(l3);
}
