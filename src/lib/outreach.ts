/**
 * Outreach vocabulary shared between the server actions and the client UI.
 * Kept out of the "use server" module (which may only export async functions)
 * so the constant arrays and types can be imported from client components.
 *
 * Mirrors the spreadsheet's per-touch columns: channel (how the agent reached
 * out) × outcome (what happened).
 */

/** Channels an agent can log a touch on, mapped 1:1 to leadEvents.type. */
export const OUTREACH_CHANNELS = ["call", "sms", "email", "whatsapp"] as const;
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number];

/** Result of a logged touch — mirrors the spreadsheet's contact outcomes. */
export const OUTREACH_OUTCOMES = [
  "answered",
  "no_answer",
  "voicemail",
  "replied",
  "not_interested",
  "wrong_number",
] as const;
export type OutreachOutcome = (typeof OUTREACH_OUTCOMES)[number];

export interface LeadActivityItem {
  id: string;
  /** leadEvents.type — call | sms | email | whatsapp | note | status_change | disqualified */
  type: string;
  /** Whether the touch was logged by hand vs. placed through the platform. */
  manual: boolean;
  outcome: OutreachOutcome | null;
  /** Free text: a note's body or an outreach's comment. */
  text: string | null;
  actor: string | null;
  at: string;
}
