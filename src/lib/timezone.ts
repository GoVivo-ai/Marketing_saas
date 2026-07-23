/**
 * Platform-wide reference timezone for user-facing schedules. The team and
 * announcements run on Bogotá time; users are spread across countries, so
 * every schedule is shown in one explicit, labeled timezone instead of each
 * viewer's local clock.
 */
const PLATFORM_TZ = "America/Bogota";

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: PLATFORM_TZ,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** "Jul 23, 2026, 9:00 PM (Bogotá time)" — deterministic, safe to SSR. */
export function formatBogota(iso: string): string {
  return `${formatter.format(new Date(iso))} (Bogotá time)`;
}
