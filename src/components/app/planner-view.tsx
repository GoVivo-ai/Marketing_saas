"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parse } from "date-fns";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { PlannerData } from "@/lib/data";
import { saveMonthlyPlan } from "@/lib/actions/planner";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const int = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (frac: number) => `${(frac * 100).toFixed(1)}%`;

const num = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const intStr = (n: number) => String(Math.max(0, Math.round(n)));

/** Shift a "YYYY-MM" key by ±n months. */
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

  // Linked calculator state. Initialised from the saved plan; derived fields
  // recompute as you edit, so budget ↔ CPL ↔ leads ↔ rate ↔ sales stay in sync.
  const [budget, setBudget] = useState(data.plan.budget ? String(data.plan.budget) : "");
  const [cpl, setCpl] = useState(data.plan.targetCpl ? String(data.plan.targetCpl) : "");
  const [leads, setLeads] = useState(data.plan.targetLeads ? String(data.plan.targetLeads) : "");
  const [rate, setRate] = useState(
    data.plan.conversionRate ? (data.plan.conversionRate * 100).toFixed(1) : "",
  );
  const [sales, setSales] = useState(data.plan.targetSales ? String(data.plan.targetSales) : "");

  // Edit handlers — each keeps the edited field raw and recomputes dependents.
  const onBudget = (v: string) => {
    setBudget(v);
    const l = num(cpl) > 0 ? num(v) / num(cpl) : 0;
    setLeads(intStr(l));
    setSales(intStr(l * (num(rate) / 100)));
  };
  const onCpl = (v: string) => {
    setCpl(v);
    const l = num(v) > 0 ? num(budget) / num(v) : 0;
    setLeads(intStr(l));
    setSales(intStr(l * (num(rate) / 100)));
  };
  const onLeads = (v: string) => {
    setLeads(v);
    setCpl(num(v) > 0 ? (num(budget) / num(v)).toFixed(2) : "");
    setSales(intStr(num(v) * (num(rate) / 100)));
  };
  const onRate = (v: string) => {
    setRate(v);
    setSales(intStr(num(leads) * (num(v) / 100)));
  };
  const onSales = (v: string) => {
    setSales(v);
    setRate(num(leads) > 0 ? ((num(v) / num(leads)) * 100).toFixed(1) : "");
  };

  // Live plan figures (drive both the inputs and the comparison "Plan" column).
  const planBudget = num(budget);
  const planCpl = num(cpl);
  const planLeads = num(leads);
  const planRate = num(rate) / 100;
  const planSales = num(sales);
  const planCpa = planSales > 0 ? planBudget / planSales : 0;

  const a = data.actuals;
  const monthLabel = format(parse(data.month, "yyyy-MM", new Date()), "MMMM yyyy");

  const goMonth = (delta: number) =>
    startNav(() => router.push(`/planner?month=${shiftMonth(data.month, delta)}`));

  const save = async () => {
    setSaving(true);
    const res = await saveMonthlyPlan({
      workspaceId,
      month: data.month,
      budget: planBudget,
      targetCpl: planCpl,
      conversionRate: planRate,
      targetLeads: planLeads,
      targetSales: planSales,
    });
    setSaving(false);
    if (res.ok) {
      toast.success(`Plan saved for ${monthLabel}`);
      router.refresh();
    } else {
      toast.error(res.error ?? "Could not save the plan");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => goMonth(-1)}
            disabled={navPending}
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[140px] text-center text-sm font-medium">
            {navPending ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : monthLabel}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => goMonth(1)}
            disabled={navPending}
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save plan
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---------- Calculator ---------- */}
        <Card>
          <CardHeader>
            <CardTitle>Plan</CardTitle>
            <CardDescription>
              Edit any field — the rest recalculates. Budget ÷ CPL = leads;
              leads × conversion rate = sales.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field
              id="budget"
              label="Max budget"
              prefix="$"
              value={budget}
              onChange={onBudget}
            />
            <Field id="cpl" label="Target CPL" prefix="$" value={cpl} onChange={onCpl} />
            <Field id="leads" label="Target leads" value={leads} onChange={onLeads} />
            <Field
              id="rate"
              label="Lead → sale conversion"
              suffix="%"
              value={rate}
              onChange={onRate}
            />
            <Field id="sales" label="Target sales" value={sales} onChange={onSales} />
            <div className="flex items-center justify-between border-t pt-3 text-sm">
              <span className="text-muted-foreground">Cost per sale (CPA)</span>
              <span className="font-medium">{planCpa ? usd(planCpa) : "—"}</span>
            </div>
          </CardContent>
        </Card>

        {/* ---------- Plan vs actual ---------- */}
        <Card>
          <CardHeader>
            <CardTitle>Plan vs. actual</CardTitle>
            <CardDescription>
              What was executed in {monthLabel} (synced spend &amp; leads; sales =
              leads won in the pipeline).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <Row label="Budget → spend" plan={usd(planBudget)} actual={usd(a.spend)}
                 delta={pace(a.spend, planBudget)} good={a.spend <= planBudget && planBudget > 0} neutral={!planBudget} />
            <Row label="Leads" plan={int(planLeads)} actual={int(a.leads)}
                 delta={attain(a.leads, planLeads)} good={a.leads >= planLeads && planLeads > 0} neutral={!planLeads} />
            <Row label="CPL" plan={planCpl ? usd(planCpl) : "—"} actual={a.cpl ? usd(a.cpl) : "—"}
                 delta={planCpl ? attain(planCpl, a.cpl) : "—"} good={a.cpl > 0 && planCpl > 0 && a.cpl <= planCpl} neutral={!planCpl || !a.cpl} />
            <Row label="Conversion" plan={planRate ? pct(planRate) : "—"} actual={pct(a.convRate)}
                 delta="" good={a.convRate >= planRate && planRate > 0} neutral={!planRate} />
            <Row label="Sales" plan={int(planSales)} actual={int(a.sales)}
                 delta={attain(a.sales, planSales)} good={a.sales >= planSales && planSales > 0} neutral={!planSales} />
            <Row label="CPA" plan={planCpa ? usd(planCpa) : "—"} actual={a.cpa ? usd(a.cpa) : "—"}
                 delta="" good={a.cpa > 0 && planCpa > 0 && a.cpa <= planCpa} neutral={!planCpa || !a.cpa} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** % of plan reached, e.g. actual 90 of plan 100 → "90%". */
function attain(actual: number, plan: number): string {
  if (!plan) return "—";
  return `${Math.round((actual / plan) * 100)}%`;
}
/** Spend pace: how much of the budget was used. */
function pace(spend: number, budget: number): string {
  if (!budget) return "—";
  return `${Math.round((spend / budget) * 100)}% used`;
}

function Field({
  id,
  label,
  value,
  onChange,
  prefix,
  suffix,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            {prefix}
          </span>
        )}
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(prefix && "pl-7", suffix && "pr-8")}
          placeholder="0"
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  plan,
  actual,
  delta,
  good,
  neutral,
}: {
  label: string;
  plan: string;
  actual: string;
  delta: string;
  good: boolean;
  neutral?: boolean;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b py-2.5 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="text-right text-sm">
        <span className="text-muted-foreground">{plan}</span>
        <span className="mx-1.5 text-muted-foreground/50">→</span>
        <span className="font-medium">{actual}</span>
      </div>
      <span
        className={cn(
          "w-16 text-right text-xs font-medium",
          neutral ? "text-muted-foreground" : good ? "text-success" : "text-destructive",
        )}
      >
        {delta}
      </span>
    </div>
  );
}
