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
  Users,
  Percent,
  Target,
  Receipt,
  ArrowRight,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { PlannerData } from "@/lib/data";
import { saveMonthlyPlan } from "@/lib/actions/planner";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = (n: number) =>
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

  // Live plan figures (drive the inputs, the funnel and the comparison).
  const planBudget = num(budget);
  const planCpl = num(cpl);
  const planLeads = num(leads);
  const planRate = num(rate) / 100;
  const planSales = num(sales);
  const planCpa = planSales > 0 ? planBudget / planSales : 0;

  const a = data.actuals;
  const monthLabel = format(parse(data.month, "yyyy-MM", new Date()), "MMMM yyyy");

  const overBudget = planBudget > 0 && a.spend > planBudget;
  const usedPct = planBudget > 0 ? (a.spend / planBudget) * 100 : 0;
  const remaining = Math.max(0, planBudget - a.spend);

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
      {/* ---------- Month nav + save ---------- */}
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
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save plan
        </Button>
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
                <span className="ml-1 text-lg font-normal text-muted-foreground">/ {usd2(planBudget)}</span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Spent so far this month · across all campaigns
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">{overBudget ? "Over budget" : "Remaining"}</p>
              <p className={cn("text-2xl font-semibold tabular-nums", overBudget && "text-destructive")}>
                {overBudget ? usd2(a.spend - planBudget) : usd2(remaining)}
              </p>
            </div>
          </div>
          <div className="mt-5 space-y-1.5">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full transition-all", overBudget ? "bg-destructive" : "bg-primary")}
                style={{ width: `${planBudget > 0 ? Math.min(100, usedPct) : 0}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{planBudget > 0 ? `${Math.round(usedPct)}% of budget used` : "Set a budget below"}</span>
              {planBudget > 0 && <span>{overBudget ? "Pace exceeds plan" : `${usd2(remaining)} left`}</span>}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ---------- Compact calculator + live funnel ---------- */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Plan</CardTitle>
            <CardDescription>Edit any field — the rest recalculates.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <Row icon={<Wallet className="h-4 w-4" />} label="Max budget" prefix="$" value={budget} onChange={onBudget} />
            <Row icon={<DollarSign className="h-4 w-4" />} label="Target CPL" prefix="$" value={cpl} onChange={onCpl} />
            <Row icon={<Users className="h-4 w-4" />} label="Target leads" value={leads} onChange={onLeads} />
            <Row icon={<Percent className="h-4 w-4" />} label="Conversion" suffix="%" value={rate} onChange={onRate} />
            <Row icon={<Target className="h-4 w-4" />} label="Target sales" value={sales} onChange={onSales} />
            <div className="flex items-center justify-between pt-3 text-sm">
              <span className="flex items-center gap-2 text-muted-foreground">
                <Receipt className="h-4 w-4" /> Cost per sale (CPA)
              </span>
              <span className="font-semibold tabular-nums">{planCpa ? usd2(planCpa) : "—"}</span>
            </div>
          </CardContent>
        </Card>

        {/* Live funnel — animates as you type. */}
        <Card>
          <CardHeader>
            <CardTitle>Funnel preview</CardTitle>
            <CardDescription>Updates live as you enter the plan.</CardDescription>
          </CardHeader>
          <CardContent>
            <PlannerFunnel
              budget={planBudget}
              cpl={planCpl}
              leads={planLeads}
              rate={planRate}
              sales={planSales}
              cpa={planCpa}
            />
          </CardContent>
        </Card>
      </div>

      {/* ---------- Plan vs actual (full width) ---------- */}
      <Card>
        <CardHeader>
          <CardTitle>Plan vs. actual</CardTitle>
          <CardDescription>
            Executed in {monthLabel} — synced spend &amp; leads; sales = leads
            won in the pipeline.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-8 md:grid-cols-2">
            <div className="space-y-4">
              <SectionLabel>Results vs. target</SectionLabel>
              <GoalBar icon={<Users className="h-3.5 w-3.5" />} label="Leads" plan={int(planLeads)} actual={int(a.leads)}
                ratio={planLeads > 0 ? a.leads / planLeads : 0}
                pct={planLeads > 0 ? `${Math.round((a.leads / planLeads) * 100)}%` : "—"} hasPlan={planLeads > 0} />
              <GoalBar icon={<Target className="h-3.5 w-3.5" />} label="Sales" plan={int(planSales)} actual={int(a.sales)}
                ratio={planSales > 0 ? a.sales / planSales : 0}
                pct={planSales > 0 ? `${Math.round((a.sales / planSales) * 100)}%` : "—"} hasPlan={planSales > 0} />
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

/** Smooth two-tier funnel that narrows by the conversion rate; animates live. */
function PlannerFunnel({
  budget,
  cpl,
  leads,
  rate,
  sales,
  cpa,
}: {
  budget: number;
  cpl: number;
  leads: number;
  rate: number;
  sales: number;
  cpa: number;
}) {
  if (leads <= 0) {
    return (
      <div className="flex h-[212px] items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
        Enter a budget and CPL to preview the funnel.
      </div>
    );
  }
  // Narrow the sales tier by the conversion rate, with a floor so its label fits.
  const salesWidth = Math.min(100, Math.max(34, leads > 0 ? (sales / leads) * 100 : 34));

  return (
    <div className="space-y-2 py-1">
      <FunnelTier
        widthPct={100}
        tone="lead"
        label="Leads"
        value={int(leads)}
        caption={`${usd(budget)} ÷ ${usd(cpl)} CPL`}
      />
      <div className="flex items-center justify-center gap-1 text-xs font-medium text-muted-foreground">
        <ChevronDown className="h-3.5 w-3.5" />
        {pct(rate)} convert
      </div>
      <FunnelTier
        widthPct={salesWidth}
        tone="sale"
        label="Sales"
        value={int(sales)}
        caption={cpa ? `${usd(cpa)} per sale` : "—"}
      />
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
          tone === "lead"
            ? "bg-gradient-to-br from-[#04d98b] to-[#026a60]"
            : "bg-gradient-to-br from-[#0a9d8f] to-[#011640]",
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</p>
  );
}

function GoalBar({
  icon,
  label,
  plan,
  actual,
  ratio,
  pct,
  hasPlan,
}: {
  icon: React.ReactNode;
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
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {icon}
          {label}
        </span>
        <span className="tabular-nums">
          <span className="text-muted-foreground">{plan}</span>
          <ArrowRight className="mx-1 inline h-3 w-3 text-muted-foreground/50" />
          <span className="font-semibold">{actual}</span>
        </span>
      </div>
      <div className="flex items-center gap-2.5">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              !hasPlan ? "bg-muted-foreground/30" : reached ? "bg-success" : "bg-primary",
            )}
            style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
          />
        </div>
        <span
          className={cn(
            "w-10 text-right text-xs font-semibold tabular-nums",
            !hasPlan ? "text-muted-foreground" : reached ? "text-success" : "text-foreground",
          )}
        >
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
      <p className={cn("mt-1 text-base font-semibold tabular-nums", good && "text-success", bad && "text-destructive")}>
        {actual}
      </p>
      <p className="text-[11px] text-muted-foreground">plan {plan}</p>
    </div>
  );
}

/** Compact calculator row: label on the left, a narrow number input on the right. */
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
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            {prefix}
          </span>
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
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}
