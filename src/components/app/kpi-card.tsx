import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  deltaPct,
  invertColors = false,
}: {
  label: string;
  value: string;
  deltaPct: number;
  /** For metrics where lower is better (CPL): green when negative. */
  invertColors?: boolean;
}) {
  // Is this change good news? For "lower is better" metrics (spend, CPL) a
  // decrease is good. Arrow direction follows the sentiment, not the raw
  // number, so green always points up and red always points down.
  const isFlat = deltaPct === 0;
  const positive = invertColors ? deltaPct < 0 : deltaPct > 0;
  const Arrow = positive ? ArrowUpRight : ArrowDownRight;

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
                : positive
                  ? "text-emerald-500"
                  : "text-red-500",
            )}
          >
            {!isFlat && <Arrow className="h-4 w-4" />}
            {Math.abs(deltaPct).toFixed(1)}%
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">vs previous 30 days</p>
      </CardContent>
    </Card>
  );
}
