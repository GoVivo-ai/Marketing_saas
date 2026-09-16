import { format, isValid, parseISO, subDays } from "date-fns";
import { endOfBusinessDay, startOfBusinessDay } from "@/lib/business-time";

/** A date-range filter resolved from URL params, ready for queries + UI. */
export interface ResolvedRange {
  /** Inclusive lower bound; null = unbounded (all time). */
  start: Date | null;
  /** Inclusive upper bound; null = unbounded. */
  end: Date | null;
  /** Human label, e.g. "Last 30 days" or "Jun 1 – Jun 10, 2026". */
  label: string;
  /** Active preset key for the picker: "7" | "30" | "90" | "all" | "custom". */
  preset: string;
}

const allTime: ResolvedRange = {
  start: null,
  end: null,
  label: "All time",
  preset: "all",
};

function presetRange(days: number): ResolvedRange {
  return {
    start: subDays(new Date(), days),
    end: new Date(),
    label: `Last ${days} days`,
    preset: String(days),
  };
}

/**
 * Resolves `?range=` / `?from=&to=` search params into a concrete window.
 * Priority: a valid custom from/to pair, then an explicit "all", then a
 * known preset, then the configured default.
 */
export function resolveDateRange(
  params: { range?: string; from?: string; to?: string },
  opts: { presets: number[]; defaultPreset: string; allowAllTime: boolean },
): ResolvedRange {
  const fromDay = params.from?.slice(0, 10);
  const toDay = params.to?.slice(0, 10);
  const fromD = fromDay ? parseISO(fromDay) : null;
  const toD = toDay ? parseISO(toDay) : null;
  if (fromDay && toDay && fromD && toD && isValid(fromD) && isValid(toD)) {
    // Picked days are business-calendar days (Meta's clock), not the
    // server's UTC ones — see lib/business-time.ts.
    let [first, last] = [fromDay, toDay];
    let [firstD, lastD] = [fromD, toD];
    if (first > last) {
      [first, last] = [last, first];
      [firstD, lastD] = [lastD, firstD];
    }
    const sameYear = firstD.getFullYear() === lastD.getFullYear();
    return {
      start: startOfBusinessDay(first),
      end: endOfBusinessDay(last),
      label: `${format(firstD, sameYear ? "MMM d" : "MMM d, yyyy")} – ${format(lastD, "MMM d, yyyy")}`,
      preset: "custom",
    };
  }

  if (params.range === "all" && opts.allowAllTime) return allTime;

  if (params.range && opts.presets.includes(Number(params.range))) {
    return presetRange(Number(params.range));
  }

  if (opts.defaultPreset === "all") return allTime;
  return presetRange(Number(opts.defaultPreset));
}
