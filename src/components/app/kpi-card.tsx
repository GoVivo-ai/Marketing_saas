import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  deltaPct,
  invertColors = false,
  comparisonLabel = "previous 30 days",
}: {
  label: string;
  value: string;
  deltaPct: number;
  /** For metrics where lower is better (CPL): green when negative. */
  invertColors?: boolean;
  /** What the delta is compared against, e.g. "previous 7 days". */
  comparisonLabel?: string;
}) {
  // The arrow always follows the real number: up if it rose, down if it
  // fell — no surprises. The color and the "better/worse" word carry the
  // judgement, so a rising cost reads as "↑ … worse" instead of a
  // contradictory down arrow.
  const isFlat = deltaPct === 0;
  const good = invertColors ? deltaPct < 0 : deltaPct > 0;
  const Arrow = deltaPct >= 0 ? ArrowUpRight : ArrowDownRight;
  const sentiment = isFlat ? "No change" : good ? "Better" : "Worse";

  return (
    <Card>
      <CardContent className="pt-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        <div className="mt-1 flex items-end justify-between">
          <p className="text-2xl font-semibold tracking-tight">{value}</p>
          <span
            className={cn(
              "flex items-center gap-0.5 text-sm font-medium",
              isFlat
                ? "text-muted-foreground"
                : good
                  ? "text-success"
                  : "text-destructive",
            )}
          >
            {!isFlat && <Arrow className="h-4 w-4" />}
            {Math.abs(deltaPct).toFixed(1)}%
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {isFlat ? (
            `No change vs ${comparisonLabel}`
          ) : (
            <>
              <span
                className={cn(
                  "font-medium",
                  good ? "text-success" : "text-destructive",
                )}
              >
                {sentiment}
              </span>{" "}
              vs {comparisonLabel}
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
}
