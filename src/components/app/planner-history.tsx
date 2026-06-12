"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, parse } from "date-fns";
import { toast } from "sonner";
import { Copy, Loader2, Trash2 } from "lucide-react";
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PlannerHistoryRow } from "@/lib/data";
import { deletePlan, duplicatePlan } from "@/lib/actions/planner";

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
  workspaceId,
  rows,
  resultLabel = "Sales",
}: {
  workspaceId: string;
  rows: PlannerHistoryRow[];
  resultLabel?: string;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  const duplicate = async (row: PlannerHistoryRow) => {
    setBusyId(row.id);
    const res = await duplicatePlan(workspaceId, row.id);
    setBusyId(null);
    if (res.ok && res.planId) {
      toast.success(`Duplicated “${row.name}”`);
      router.push(`/planner?plan=${res.planId}`);
    } else {
      toast.error(res.error ?? "Could not duplicate the plan");
    }
  };

  const remove = async (row: PlannerHistoryRow) => {
    setBusyId(row.id);
    const res = await deletePlan(workspaceId, row.id);
    setBusyId(null);
    if (res.ok) {
      toast.success(`Plan deleted — ${row.name}`);
      router.refresh();
    } else {
      toast.error(res.error ?? "Could not delete the plan");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Saved plans</CardTitle>
        <CardDescription>
          Every plan you&apos;ve saved and how it actually performed. Open one
          to keep working on it, duplicate it as a starting point, or delete it.
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
                <TableHead>Plan</TableHead>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Budget → spent</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">{resultLabel}</TableHead>
                <TableHead className="text-right">CPL</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const overBudget = r.budget > 0 && r.spend > r.budget;
                const busy = busyId === r.id;
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        href={`/planner?plan=${r.id}`}
                        className="font-medium hover:underline"
                      >
                        {r.name || format(parse(r.month, "yyyy-MM", new Date()), "MMM yyyy")}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(parse(r.month, "yyyy-MM", new Date()), "MMM yyyy")}
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
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={() => duplicate(r)}
                          disabled={busy}
                          aria-label={`Duplicate ${r.name}`}
                        >
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                        <Dialog>
                          <DialogTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                disabled={busy}
                                aria-label={`Delete ${r.name}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            }
                          />
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Delete this plan?</DialogTitle>
                              <DialogDescription>
                                This removes “{r.name}”. Your executed actuals
                                are not affected.
                              </DialogDescription>
                            </DialogHeader>
                            <DialogFooter>
                              <DialogClose render={<Button variant="outline">Cancel</Button>} />
                              <DialogClose
                                render={
                                  <Button variant="destructive" onClick={() => remove(r)}>
                                    Delete plan
                                  </Button>
                                }
                              />
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </div>
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
