"use client";

import { useEffect, useState } from "react";

/**
 * Renders an ISO instant in the viewer's own timezone, with the zone spelled
 * out (e.g. "Jul 23, 2026, 9:00 PM GMT-5") so schedules are unambiguous for
 * users across countries.
 *
 * SSR renders a deterministic UTC fallback — identical on server and client,
 * so hydration matches — and an effect swaps in the viewer's local time after
 * mount. (Rendering the local time directly during hydration doesn't work:
 * React reconciles against the client-computed text and leaves the stale
 * server DOM untouched.)
 */
const fmt = (iso: string, timeZone?: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  }).format(new Date(iso));

export function LocalDateTime({ iso }: { iso: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    // One-shot post-mount swap to the viewer's timezone — can't be computed
    // during render without a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(fmt(iso));
  }, [iso]);
  return <span>{text ?? fmt(iso, "UTC")}</span>;
}
