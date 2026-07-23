"use client";

import { useEffect, useState } from "react";

/**
 * Renders an ISO instant in the viewer's own timezone, with the zone spelled
 * out (e.g. "Jul 23, 2026, 9:00 PM GMT-5") so schedules are unambiguous for
 * users across countries. Server output uses the server's zone, so the real
 * value is swapped in after mount (suppressHydrationWarning covers the
 * one-off text mismatch).
 */
const fmt = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));

export function LocalDateTime({ iso }: { iso: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    // One-shot post-mount swap to the viewer's timezone — can't be computed
    // during render without a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(fmt(iso));
  }, [iso]);
  return <span suppressHydrationWarning>{text ?? fmt(iso)}</span>;
}
