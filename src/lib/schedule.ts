/** Shared schedule-availability logic for lead qualification. */

export type ScheduleStatus = "full" | "partial" | "none" | "unknown";

export interface ScheduleAnswer {
  /**
   * full = available for every required block, partial = some blocks only,
   * none = can't work the required schedule, unknown = question not answered.
   */
  status: ScheduleStatus;
  /** The block they DID pick when partial, for display. */
  block: "morning" | "afternoon" | null;
}

/**
 * Reads the schedule-availability answer from a lead's raw Meta form data.
 * The forms ask it two ways — "Are you available to work both required time
 * blocks?" (yes/no) and "Which schedule are you available for?"
 * (both/morning_only/afternoon_only/neither) — so we find any schedule-shaped
 * question and interpret its answer. When several answer, the most
 * restrictive verdict wins.
 */
export function scheduleAnswer(
  formData: Record<string, unknown> | null | undefined,
): ScheduleAnswer {
  if (!formData) return { status: "unknown", block: null };

  let best: ScheduleAnswer | null = null;
  const worse = (a: ScheduleAnswer, b: ScheduleAnswer) => {
    const rank: Record<ScheduleStatus, number> = {
      none: 3,
      partial: 2,
      full: 1,
      unknown: 0,
    };
    return rank[a.status] >= rank[b.status] ? a : b;
  };

  for (const [key, value] of Object.entries(formData)) {
    const k = key.toLowerCase();
    if (!/(time_block|schedule|horario|turno)/.test(k)) continue;
    const parsed = parseSchedule(String(value ?? ""));
    if (!parsed) continue;
    best = best ? worse(best, parsed) : parsed;
  }
  return best ?? { status: "unknown", block: null };
}

/** Interpret one schedule answer, or null when it isn't one. */
function parseSchedule(text: string): ScheduleAnswer | null {
  const v = text.trim().toLowerCase().replace(/_/g, " ");
  if (!v) return null;
  if (v === "neither" || /^no\b/.test(v)) return { status: "none", block: null };
  if (/morning\s*only/.test(v)) return { status: "partial", block: "morning" };
  if (/afternoon\s*only/.test(v)) return { status: "partial", block: "afternoon" };
  if (/^yes\b/.test(v) || /\bboth\b/.test(v)) return { status: "full", block: null };
  return null;
}
