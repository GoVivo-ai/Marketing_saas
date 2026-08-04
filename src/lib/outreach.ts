/**
 * Outreach vocabulary shared between the server actions and the client UI.
 * Kept out of the "use server" module (which may only export async functions)
 * so the constant arrays and types can be imported from client components.
 *
 * Mirrors the spreadsheet's per-touch columns: channel (how the agent reached
 * out) × outcome (what happened).
 */

/**
 * How long a lead's "being worked right now" claim holds before it expires on
 * its own — long enough for a call + notes, short enough that an abandoned
 * lead frees itself.
 */
export const LEAD_CLAIM_TTL_MS = 15 * 60_000;

/** Channels an agent can log a touch on, mapped 1:1 to leadEvents.type. */
export const OUTREACH_CHANNELS = ["call", "sms", "email", "whatsapp"] as const;
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number];

/** Result of a logged touch — mirrors the spreadsheet's contact outcomes. */
export const OUTREACH_OUTCOMES = [
  "answered",
  "no_answer",
  "voicemail",
  "replied",
  // Outbound-only touch: the agent sent an email/SMS and is waiting — the
  // contact happened but there's no response to grade yet.
  "sent",
  "not_interested",
  "wrong_number",
] as const;
export type OutreachOutcome = (typeof OUTREACH_OUTCOMES)[number];

/**
 * One-click outcome chips — the dot carries the sentiment (like the stage
 * pills) so the buttons stay visually quiet. Shared by the Contact Queue card
 * and the lead detail's Activity logger so both surfaces offer the same
 * options.
 */
export const OUTCOME_CHIPS: {
  outcome: OutreachOutcome;
  label: string;
  dot: string;
}[] = [
  { outcome: "answered", label: "Answered", dot: "bg-success" },
  { outcome: "replied", label: "Replied", dot: "bg-success" },
  { outcome: "voicemail", label: "Voicemail", dot: "bg-amber-500" },
  { outcome: "no_answer", label: "No answer", dot: "bg-amber-500" },
  { outcome: "sent", label: "Email / SMS sent", dot: "bg-sky-500" },
  { outcome: "not_interested", label: "Not interested", dot: "bg-destructive" },
  { outcome: "wrong_number", label: "Wrong number", dot: "bg-destructive" },
];

/**
 * Terminal outcomes ask for the RCA reason before moving on, pre-filled with
 * the most likely path from the shared taxonomy so it usually stays 1 click.
 * Shared by the Contact Queue card and the lead detail's outreach logger so
 * both surfaces run the same disqualification flow.
 */
export const DISQUAL_PREFILL: Partial<
  Record<OutreachOutcome, { l1: string; l2: string; l3: string }>
> = {
  not_interested: {
    l1: "Candidate Driven",
    l2: "Interest / Decision",
    l3: "Contacted - No Interested",
  },
  wrong_number: {
    l1: "Agent Driven",
    l2: "Contactability",
    l3: "Wrong number - email sent to confirm",
  },
};

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
