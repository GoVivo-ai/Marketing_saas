"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";

/**
 * Renders an ISO datetime in the viewer's local timezone. Server-rendered
 * output uses the server's zone, so the real value is swapped in after mount
 * (suppressHydrationWarning covers the one-off text mismatch).
 */
export function LocalDateTime({ iso }: { iso: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    // One-shot post-mount swap to the viewer's timezone — can't be computed
    // during render without a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(format(new Date(iso), "PPp"));
  }, [iso]);
  return <span suppressHydrationWarning>{text ?? format(new Date(iso), "PPp")}</span>;
}
