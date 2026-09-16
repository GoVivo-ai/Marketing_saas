/**
 * The calendar the reports run on.
 *
 * Meta reports every metric by day in the ad account's time zone, and every
 * connected account is America/Los_Angeles. Our servers run in UTC, so cutting
 * days there put a lead that arrived at 5:27 pm Pacific on the next day — a
 * one-day filter showed 1 lead while Ads Manager showed 3 for the same day.
 * Day boundaries follow Meta's clock instead.
 */
export const BUSINESS_TIME_ZONE = "America/Los_Angeles";

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const partsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/** The business-calendar day an instant falls on, as "yyyy-MM-dd". */
export function businessDay(d: Date): string {
  return dayFormat.format(d);
}

/** How far the business zone's wall clock is ahead of UTC at `d`, in ms. */
function zoneOffsetMs(d: Date): number {
  const p = Object.fromEntries(
    partsFormat.formatToParts(d).map((x) => [x.type, Number(x.value)]),
  );
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(d.getTime() / 1000) * 1000;
}

/** Midnight of a "yyyy-MM-dd" business day, as a UTC instant. */
export function startOfBusinessDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  // The offset at midnight can differ from the guess's across a DST switch.
  const first = guess - zoneOffsetMs(new Date(guess));
  return new Date(guess - zoneOffsetMs(new Date(first)));
}

/** The last millisecond of a "yyyy-MM-dd" business day. */
export function endOfBusinessDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return new Date(startOfBusinessDay(next).getTime() - 1);
}
