"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parse } from "date-fns";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Loader2,
  Wallet,
  DollarSign,
  Percent,
  Receipt,
  ArrowRight,
  Trash2,
  MapPin,
} from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { cn } from "@/lib/utils";
import type { PlannerData, CityPlanRow } from "@/lib/data";
import { saveMonthlyPlan, deleteMonthlyPlan } from "@/lib/actions/planner";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const int = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (frac: number) => `${(frac * 100).toFixed(1)}%`;

const num = (s: string | undefined) => {
  const n = parseFloat(s ?? "");
  return Number.isFinite(n) && n > 0 ? n : 0;
};

function shiftMonth(key: string, delta: number): string {
  const d = parse(key, "yyyy-MM", new Date());
  return format(new Date(d.getFullYear(), d.getMonth() + delta, 1), "yyyy-MM");
}

export function PlannerView({
  workspaceId,
  data,
}: {
  workspaceId: string;
  data: PlannerData;
}) {
  const router = useRouter();
  const [navPending, startNav] = useTransition();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const label = data.resultLabel || "Sales";

  // When no cities are targeted yet (no ad sets), fall back to a single
  // "Overall" row so the planner still works for non-geo campaigns.
  const cityRows: CityPlanRow[] = data.cities.length
    ? data.cities
    : [
        {
          cityName: "Overall",
          targetResults: data.plan.targetSales,
          actualSpend: data.actuals.spend,
          actualLeads: data.actuals.leads,
          actualResults: data.actuals.sales,
        },
      ];

  // Global assumptions.
  const [cpl, setCpl] = useState(data.plan.targetCpl ? String(data.plan.targetCpl) : "");
  const [rate, setRate] = useState(
    data.plan.conversionRate ? (data.plan.conversionRate * 100).toFixed(1) : "",
  );
  // Per-city result goals, keyed by city name.
  const [targets, setTargets] = useState<Record<string, string>>(
    Object.fromEntries(cityRows.map((c) => [c.cityName, c.targetResults ? String(c.targetResults) : ""])),
  );

  const planCpl = num(cpl);
  const planRate = num(rate) / 100; // fraction
  const perLead = planRate > 0 ? 1 / planRate : 0; // leads per result

  // Derive each city's leads & budget from its goal + the assumptions.
  const derived = cityRows.map((c) => {
    const goal = num(targets[c.cityName]);
    const leads = goal * perLead;
    const budget = leads * planCpl;
    return { city: c, goal, leads, budget };
  });
  const totalResults = derived.reduce((s, d) => s + d.goal, 0);
  const totalLeads = derived.reduce((s, d) => s + d.leads, 0);
  const totalBudget = derived.reduce((s, d) => s + d.budget, 0);
  const planCpa = totalResults > 0 ? totalBudget / totalResults : 0;

  const a = data.actuals;
  const monthLabel = format(parse(data.month, "yyyy-MM", new Date()), "MMMM yyyy");
  const overBudget = totalBudget > 0 && a.spend > totalBudget;
  const usedPct = totalBudget > 0 ? (a.spend / totalBudget) * 100 : 0;
  const remaining = Math.max(0, totalBudget - a.spend);

  const goMonth = (delta: number) =>
    startNav(() => router.push(`/planner?month=${shiftMonth(data.month, delta)}`));

  const save = async () => {
    setSaving(true);
    const res = await saveMonthlyPlan({
      workspaceId,
      month: data.month,
      budget: totalBudget,
      targetCpl: planCpl,
      conversionRate: planRate,
      targetLeads: totalLeads,
      targetSales: totalResults,
      cityTargets: derived
        .filter((d) => d.city.cityName !== "Overall" || d.goal > 0)
        .map((d) => ({ cityName: d.city.cityName, targetResults: d.goal })),
    });
    setSaving(false);
    if (res.ok) {
      toast.success(`Plan saved for ${monthLabel}`);
      router.refresh();
    } else {
      toast.error(res.error ?? "Could not save the plan");
    }
  };

  const remove = async () => {
    setDeleting(true);
    const res = await deleteMonthlyPlan(workspaceId, data.month);
    setDeleting(false);
    if (res.ok) {
      setCpl("");
      setRate("");
      setTargets({});
      toast.success(`Plan deleted for ${monthLabel}`);
      router.refresh();
    } else {
      toast.error(res.error ?? "Could not delete the plan");
    }
  };

  return (
    <div className="space-y-6">
      {/* ---------- Month nav + actions ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border bg-card p-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => goMonth(-1)} disabled={navPending} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[130px] text-center text-sm font-semibold">
            {navPending ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : monthLabel}
          </span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => goMonth(1)} disabled={navPending} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {data.plan.exists && (
            <Dialog>
              <DialogTrigger
                render={
                  <Button variant="destructive" disabled={deleting}>
                    {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                    Delete
                  </Button>
                }
              />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete this plan?</DialogTitle>
                  <DialogDescription>
                    This removes the saved plan for {monthLabel}. Your executed
                    actuals are not affected.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose render={<Button variant="outline">Cancel</Button>} />
                  <DialogClose render={<Button variant="destructive" onClick={remove}>Delete plan</Button>} />
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save plan
          </Button>
        </div>
      </div>

      {/* ---------- Budget hero ---------- */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Wallet className="h-4 w-4" /> Budget · {monthLabel}
              </p>
              <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">
                {usd2(a.spend)}
                <span className="ml-1 text-lg font-normal text-muted-foreground">/ {usd2(totalBudget)}</span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Spent so far this month · budget = sum of every city
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">{overBudget ? "Over budget" : "Remaining"}</p>
              <p className={cn("text-2xl font-semibold tabular-nums", overBudget && "text-destructive")}>
                {overBudget ? usd2(a.spend - totalBudget) : usd2(remaining)}
              </p>
            </div>
          </div>
          <div className="mt-5 space-y-1.5">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full transition-all", overBudget ? "bg-destructive" : "bg-primary")}
                style={{ width: `${totalBudget > 0 ? Math.min(100, usedPct) : 0}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{totalBudget > 0 ? `${Math.round(usedPct)}% of budget used` : "Set goals below"}</span>
              {totalBudget > 0 && <span>{overBudget ? "Pace exceeds plan" : `${usd2(remaining)} left`}</span>}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ---------- Assumptions + funnel ---------- */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Assumptions</CardTitle>
            <CardDescription>
              Set your CPL and {label.toLowerCase()} conversion. Each city&apos;s
              goal below uses these to size leads and budget.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <Row icon={<DollarSign className="h-4 w-4" />} label="Target CPL" prefix="$" value={cpl} onChange={setCpl} />
            <Row icon={<Percent className="h-4 w-4" />} label={`Lead → ${label.toLowerCase()} conversion`} suffix="%" value={rate} onChange={setRate} />
            <div className="grid grid-cols-3 gap-3 pt-3">
              <Summary label={label} value={int(totalResults)} />
              <Summary label="Leads" value={int(totalLeads)} />
              <Summary label="Budget" value={usd(totalBudget)} />
            </div>
            <div className="flex items-center justify-between pt-3 text-sm">
              <span className="flex items-center gap-2 text-muted-foreground">
                <Receipt className="h-4 w-4" /> Cost per {label.toLowerCase().replace(/s$/, "")} (CPA)
              </span>
              <span className="font-semibold tabular-nums">{planCpa ? usd2(planCpa) : "—"}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Funnel preview</CardTitle>
            <CardDescription>Total leads narrowing to {label.toLowerCase()}.</CardDescription>
          </CardHeader>
          <CardContent>
            <Funnel leads={totalLeads} rate={planRate} results={totalResults} resultLabel={label} budget={totalBudget} cpl={planCpl} cpa={planCpa} />
          </CardContent>
        </Card>
      </div>

      {/* ---------- Per-city plan ---------- */}
      <Card>
        <CardHeader>
          <CardTitle>By city</CardTitle>
          <CardDescription>
            Set a {label.toLowerCase()} goal per city — leads and budget size
            automatically. Actuals come from synced spend, leads and pipeline
            wins.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>City</TableHead>
                <TableHead className="text-right">{label} goal</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Budget</TableHead>
                <TableHead className="text-right text-muted-foreground">Spent</TableHead>
                <TableHead className="text-right text-muted-foreground">Leads</TableHead>
                <TableHead className="text-right text-muted-foreground">{label}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {derived.map(({ city, goal, leads, budget }) => (
                <TableRow key={city.cityName}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                      {city.cityName}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      min={0}
                      value={targets[city.cityName] ?? ""}
                      onChange={(e) =>
                        setTargets((t) => ({ ...t, [city.cityName]: e.target.value }))
                      }
                      className="ml-auto h-8 w-20 text-right tabular-nums"
                      placeholder="0"
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{goal ? int(leads) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{goal ? usd(budget) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{usd(city.actualSpend)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{int(city.actualLeads)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{int(city.actualResults)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <tfoot>
              <TableRow className="border-t-2 font-medium">
                <TableCell>Total</TableCell>
                <TableCell className="text-right tabular-nums">{int(totalResults)}</TableCell>
                <TableCell className="text-right tabular-nums">{int(totalLeads)}</TableCell>
                <TableCell className="text-right tabular-nums">{usd(totalBudget)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{usd(a.spend)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{int(a.leads)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{int(a.sales)}</TableCell>
              </TableRow>
            </tfoot>
          </Table>
        </CardContent>
      </Card>

      {/* ---------- Plan vs actual ---------- */}
      <Card>
        <CardHeader>
          <CardTitle>Plan vs. actual</CardTitle>
          <CardDescription>
            Executed in {monthLabel} — synced spend &amp; leads; {label.toLowerCase()} = pipeline wins.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-8 md:grid-cols-2">
            <div className="space-y-4">
              <SectionLabel>Results vs. target</SectionLabel>
              <GoalBar label="Leads" plan={int(totalLeads)} actual={int(a.leads)}
                ratio={totalLeads > 0 ? a.leads / totalLeads : 0}
                pct={totalLeads > 0 ? `${Math.round((a.leads / totalLeads) * 100)}%` : "—"} hasPlan={totalLeads > 0} />
              <GoalBar label={label} plan={int(totalResults)} actual={int(a.sales)}
                ratio={totalResults > 0 ? a.sales / totalResults : 0}
                pct={totalResults > 0 ? `${Math.round((a.sales / totalResults) * 100)}%` : "—"} hasPlan={totalResults > 0} />
            </div>
            <div className="space-y-3">
              <SectionLabel>Efficiency</SectionLabel>
              <div className="grid grid-cols-3 gap-3">
                <EffTile label="CPL" actual={a.cpl ? usd2(a.cpl) : "—"} plan={planCpl ? usd2(planCpl) : "—"}
                  good={a.cpl > 0 && planCpl > 0 && a.cpl <= planCpl} bad={a.cpl > 0 && planCpl > 0 && a.cpl > planCpl} />
                <EffTile label="CPA" actual={a.cpa ? usd2(a.cpa) : "—"} plan={planCpa ? usd2(planCpa) : "—"}
                  good={a.cpa > 0 && planCpa > 0 && a.cpa <= planCpa} bad={a.cpa > 0 && planCpa > 0 && a.cpa > planCpa} />
                <EffTile label="Conversion" actual={pct(a.convRate)} plan={planRate ? pct(planRate) : "—"}
                  good={planRate > 0 && a.convRate >= planRate} bad={planRate > 0 && a.convRate < planRate && a.leads > 0} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Funnel({
  leads,
  rate,
  results,
  resultLabel,
  budget,
  cpl,
  cpa,
}: {
  leads: number;
  rate: number;
  results: number;
  resultLabel: string;
  budget: number;
  cpl: number;
  cpa: number;
}) {
  if (leads <= 0) {
    return (
      <div className="flex h-[212px] items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
        Add a CPL and city goals to preview the funnel.
      </div>
    );
  }
  const salesWidth = Math.min(100, Math.max(34, leads > 0 ? (results / leads) * 100 : 34));
  return (
    <div className="space-y-2 py-1">
      <FunnelTier widthPct={100} tone="lead" label="Leads" value={int(leads)} caption={`${usd(budget)} ÷ ${usd(cpl)} CPL`} />
      <div className="flex items-center justify-center gap-1 text-xs font-medium text-muted-foreground">
        <ChevronDown className="h-3.5 w-3.5" />
        {pct(rate)} convert
      </div>
      <FunnelTier widthPct={salesWidth} tone="sale" label={resultLabel} value={int(results)} caption={cpa ? `${usd(cpa)} each` : "—"} />
    </div>
  );
}

function FunnelTier({
  widthPct,
  tone,
  label,
  value,
  caption,
}: {
  widthPct: number;
  tone: "lead" | "sale";
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <div className="mx-auto transition-all duration-300" style={{ width: `${widthPct}%` }}>
      <div
        className={cn(
          "rounded-xl px-4 py-3 text-white shadow-sm",
          tone === "lead" ? "bg-gradient-to-br from-[#04d98b] to-[#026a60]" : "bg-gradient-to-br from-[#0a9d8f] to-[#011640]",
        )}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-white/90">{label}</span>
          <span className="text-xl font-bold tabular-nums">{value}</span>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-white/70">{caption}</p>
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/60 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</p>;
}

function GoalBar({
  label,
  plan,
  actual,
  ratio,
  pct,
  hasPlan,
}: {
  label: string;
  plan: string;
  actual: string;
  ratio: number;
  pct: string;
  hasPlan: boolean;
}) {
  const reached = ratio >= 1;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">
          <span className="text-muted-foreground">{plan}</span>
          <ArrowRight className="mx-1 inline h-3 w-3 text-muted-foreground/50" />
          <span className="font-semibold">{actual}</span>
        </span>
      </div>
      <div className="flex items-center gap-2.5">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-all", !hasPlan ? "bg-muted-foreground/30" : reached ? "bg-success" : "bg-primary")}
            style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
          />
        </div>
        <span className={cn("w-10 text-right text-xs font-semibold tabular-nums", !hasPlan ? "text-muted-foreground" : reached ? "text-success" : "text-foreground")}>
          {pct}
        </span>
      </div>
    </div>
  );
}

function EffTile({
  label,
  actual,
  plan,
  good,
  bad,
}: {
  label: string;
  actual: string;
  plan: string;
  good: boolean;
  bad: boolean;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-base font-semibold tabular-nums", good && "text-success", bad && "text-destructive")}>{actual}</p>
      <p className="text-[11px] text-muted-foreground">plan {plan}</p>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
  onChange,
  prefix,
  suffix,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b py-2 last:border-0">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        {label}
      </span>
      <div className="relative w-36">
        {prefix && (
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{prefix}</span>
        )}
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn("h-9 text-right tabular-nums", prefix && "pl-6", suffix && "pr-7")}
          placeholder="0"
        />
        {suffix && (
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{suffix}</span>
        )}
      </div>
    </div>
  );
}
