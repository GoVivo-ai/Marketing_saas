import Link from "next/link";
import { format, parse } from "date-fns";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { PlannerHistoryRow } from "@/lib/data";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const int = (n: number) => Math.round(n).toLocaleString("en-US");
const attainPct = (actual: number, target: number) =>
  target > 0 ? `${Math.round((actual / target) * 100)}%` : "—";

/** Plan → actual cell with the target, the executed value and attainment %. */
function PlanActual({
  target,
  actual,
  good,
}: {
  target: string;
  actual: string;
  good: boolean;
}) {
  return (
    <span className="tabular-nums">
      <span className="text-muted-foreground">{target}</span>
      <span className="mx-1 text-muted-foreground/40">→</span>
      <span className={cn("font-medium", good && "text-success")}>{actual}</span>
    </span>
  );
}

export function PlannerHistory({
  rows,
  resultLabel = "Sales",
}: {
  rows: PlannerHistoryRow[];
  resultLabel?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Saved plans</CardTitle>
        <CardDescription>
          Every month you&apos;ve planned and how it actually performed. Click a
          month to open it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No saved plans yet. Set a budget and targets above, then “Save plan”.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Budget → spent</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">{resultLabel}</TableHead>
                <TableHead className="text-right">CPL</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const overBudget = r.budget > 0 && r.spend > r.budget;
                return (
                  <TableRow key={r.month}>
                    <TableCell>
                      <Link
                        href={`/planner?month=${r.month}`}
                        className="font-medium hover:underline"
                      >
                        {format(parse(r.month, "yyyy-MM", new Date()), "MMM yyyy")}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="text-muted-foreground">{usd(r.budget)}</span>
                      <span className="mx-1 text-muted-foreground/40">→</span>
                      <span className={cn("font-medium", overBudget && "text-destructive")}>
                        {usd(r.spend)}
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {r.budget > 0 ? `${Math.round((r.spend / r.budget) * 100)}%` : "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <PlanActual
                        target={int(r.targetLeads)}
                        actual={int(r.leads)}
                        good={r.targetLeads > 0 && r.leads >= r.targetLeads}
                      />
                      <span className="ml-2 text-xs text-muted-foreground">
                        {attainPct(r.leads, r.targetLeads)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <PlanActual
                        target={int(r.targetSales)}
                        actual={int(r.sales)}
                        good={r.targetSales > 0 && r.sales >= r.targetSales}
                      />
                      <span className="ml-2 text-xs text-muted-foreground">
                        {attainPct(r.sales, r.targetSales)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="text-muted-foreground">
                        {r.targetCpl ? usd(r.targetCpl) : "—"}
                      </span>
                      <span className="mx-1 text-muted-foreground/40">→</span>
                      <span
                        className={cn(
                          "font-medium",
                          r.cpl > 0 && r.targetCpl > 0 && r.cpl <= r.targetCpl && "text-success",
                          r.cpl > 0 && r.targetCpl > 0 && r.cpl > r.targetCpl && "text-destructive",
                        )}
                      >
                        {r.cpl ? usd(r.cpl) : "—"}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
