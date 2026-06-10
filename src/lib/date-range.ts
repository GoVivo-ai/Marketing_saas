import { endOfDay, format, isValid, parseISO, startOfDay, subDays } from "date-fns";

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
  const fromD = params.from ? parseISO(params.from) : null;
  const toD = params.to ? parseISO(params.to) : null;
  if (fromD && toD && isValid(fromD) && isValid(toD)) {
    let start = startOfDay(fromD);
    let end = startOfDay(toD);
    if (start > end) [start, end] = [end, start];
    const sameYear = start.getFullYear() === end.getFullYear();
    return {
      start,
      end: endOfDay(end),
      label: `${format(start, sameYear ? "MMM d" : "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`,
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
