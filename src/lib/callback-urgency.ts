/**
 * How close a scheduled callback is, as one of four colour bands. Shared by
 * the header reminder and the queue badge so "orange" means the same thing
 * everywhere: calm (> 4 h), soon (≤ 4 h), imminent (≤ 1 h), due (now or
 * overdue).
 */
export type CallbackUrgency = "calm" | "soon" | "imminent" | "due";

export const SOON_MS = 4 * 60 * 60_000;
export const IMMINENT_MS = 60 * 60_000;

export function callbackUrgency(at: Date | string, now = Date.now()): CallbackUrgency {
  const ms = new Date(at).getTime() - now;
  if (ms <= 0) return "due";
  if (ms <= IMMINENT_MS) return "imminent";
  if (ms <= SOON_MS) return "soon";
  return "calm";
}

/** Tailwind text colour per band (icon, dot, label). */
export const URGENCY_TEXT: Record<CallbackUrgency, string> = {
  calm: "text-muted-foreground",
  soon: "text-amber-500",
  imminent: "text-orange-500",
  due: "text-red-500",
};

/** Tailwind background per band (badge dot). */
export const URGENCY_BG: Record<CallbackUrgency, string> = {
  calm: "bg-muted-foreground/60",
  soon: "bg-amber-500",
  imminent: "bg-orange-500",
  due: "bg-red-500",
};

export const URGENCY_LABEL: Record<CallbackUrgency, string> = {
  calm: "Scheduled",
  soon: "Within 4 hours",
  imminent: "Within the hour",
  due: "Due now",
};

/** The most pressing band of a set — drives the header icon's colour. */
export function worstUrgency(dates: (Date | string)[], now = Date.now()): CallbackUrgency | null {
  const order: CallbackUrgency[] = ["calm", "soon", "imminent", "due"];
  let worst = -1;
  for (const d of dates) worst = Math.max(worst, order.indexOf(callbackUrgency(d, now)));
  return worst < 0 ? null : order[worst];
}
