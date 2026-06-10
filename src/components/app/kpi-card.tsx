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
  const positive = invertColors ? deltaPct < 0 : deltaPct > 0;
  const Arrow = deltaPct >= 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <Card>
      <CardContent className="pt-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        <div className="mt-1 flex items-end justify-between">
          <p className="text-2xl font-semibold tracking-tight">{value}</p>
          <span
            className={cn(
              "flex items-center gap-0.5 text-sm font-medium",
              positive ? "text-emerald-500" : "text-red-500",
            )}
          >
            <Arrow className="h-4 w-4" />
            {Math.abs(deltaPct).toFixed(1)}%
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">vs previous week</p>
      </CardContent>
    </Card>
  );
}
