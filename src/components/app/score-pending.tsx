"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * Scoring normally lands within minutes of the lead arriving; past this age a
 * missing score means the pipeline is stalled (no API credits, dead key), not
 * "still working".
 */
const SCORE_FRESH_MS = 60 * 60 * 1000;

/**
 * What to show where a lead's AI score would go while it has none. A fresh
 * lead gets the honest spinner; an old one gets a static "Sin score" — an
 * endless "Procesando…" on month-old leads told the team the AI was working
 * when it had actually been failing.
 */
export function ScorePending({
  createdAt,
  className = "",
}: {
  createdAt: Date | string;
  className?: string;
}) {
  // Captured once per mount — the render itself stays pure, and a badge
  // flipping from spinner to "Sin score" mid-view isn't worth a timer.
  const [now] = useState(() => Date.now());
  const age = now - new Date(createdAt).getTime();
  if (age > SCORE_FRESH_MS) {
    return (
      <span
        title="This lead hasn't been scored — the AI scoring may be paused (check the Anthropic API credits in Settings)."
        className={`inline-flex items-center gap-1 text-muted-foreground ${className}`}
      >
        Sin score
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 text-muted-foreground ${className}`}
    >
      <Loader2 className="h-3 w-3 animate-spin" />
      Procesando…
    </span>
  );
}
