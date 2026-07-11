import {
  FileBarChart,
  Mail,
  MessageCircle,
  Filter,
  Ban,
  ArrowDown,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DateRangePicker } from "@/components/app/date-range-picker";
import { LeadsMultiFilter } from "@/components/app/leads-filter";
import {
  getFunnelReport,
  getWorkspaceContext,
  getWorkspaceGeoOptions,
} from "@/lib/data";
import { resolveDateRange } from "@/lib/date-range";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const RANGES = [
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last 12 months" },
  { value: "all", label: "All time" },
];
const DEFAULT_RANGE = "all";

const planned = [
  {
    icon: FileBarChart,
    title: "Auto-generated client reports",
    body: "Branded weekly/monthly PDF reports written by the AI analyst: spend, results, what changed and why, and the plan for next period. Zero manual work for the team.",
  },
  {
    icon: Mail,
    title: "Email digests",
    body: "Every Monday morning each client receives an executive summary of their account — readable in 60 seconds on a phone.",
  },
  {
    icon: MessageCircle,
    title: "WhatsApp alerts",
    body: "Critical anomalies (spend spikes, tracking outages, CPL jumps) are pushed to the team's WhatsApp the moment they are detected.",
  },
];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string;
    from?: string;
    to?: string;
    state?: string;
    city?: string;
  }>;
}) {
  const sp = await searchParams;
  const resolved = resolveDateRange(sp, {
    presets: [30, 90, 365],
    defaultPreset: DEFAULT_RANGE,
    allowAllTime: true,
  });
  // Multi-select location filters — comma-separated in the URL, absent = all.
  const states = sp.state ? sp.state.split(",").filter(Boolean) : [];
  const cities = sp.city ? sp.city.split(",").filter(Boolean) : [];

  const { active } = await getWorkspaceContext();
  const [funnel, geo] = active
    ? await Promise.all([
        getFunnelReport(active.id, {
          start: resolved.start,
          end: resolved.end,
          regions: states,
          cities,
        }),
        getWorkspaceGeoOptions(active.id),
      ])
    : [null, []];

  const stateOptions = [
    ...new Set(geo.map((g) => g.region).filter(Boolean)),
  ].sort() as string[];
  const cityOptions = [
    ...new Set(
      geo
        .filter(
          (g) => states.length === 0 || (g.region && states.includes(g.region)),
        )
        .map((g) => g.city)
        .filter(Boolean),
    ),
  ].sort() as string[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {active ? `${active.name} — Reports` : "Reports"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Every lead counts from the moment it enters — not only once it
            completes the process
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LeadsMultiFilter
            param="state"
            icon="state"
            title="State"
            allLabel="All states"
            activeValues={states}
            options={stateOptions.map((s) => ({ value: s, label: s }))}
          />
          <LeadsMultiFilter
            param="city"
            icon="city"
            title="City"
            allLabel="All cities"
            activeValues={cities}
            options={cityOptions.map((c) => ({ value: c, label: c }))}
          />
          <label className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Period
            </span>
            <DateRangePicker
              presets={RANGES}
              defaultValue={DEFAULT_RANGE}
              label={resolved.label}
            />
          </label>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ── The 4-stage funnel ─────────────────────────────────────── */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-primary" />
              Lead funnel
            </CardTitle>
            <CardDescription>
              How many leads ever reached each stage · {resolved.label} ·{" "}
              {funnel?.total ?? 0} leads
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!funnel || funnel.total === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No leads in {resolved.label.toLowerCase()}.
              </p>
            ) : (
              <div className="space-y-1">
                {funnel.steps.map((step, i) => (
                  <div key={step.id}>
                    {i > 0 && (
                      <p className="flex items-center gap-1 py-1 pl-1 text-xs text-muted-foreground">
                        <ArrowDown className="h-3 w-3" />
                        {step.pctOfPrev != null
                          ? `${step.pctOfPrev}% of ${funnel.steps[i - 1].name}`
                          : "—"}
                      </p>
                    )}
                    <div className="flex items-center gap-3">
                      <div className="h-9 flex-1 overflow-hidden rounded-md bg-muted/40">
                        <div
                          className={cn(
                            "flex h-full min-w-fit items-center gap-2 rounded-md px-3",
                            !step.color && "bg-primary/15",
                          )}
                          style={{
                            width: `${Math.max(step.pctOfTotal, 4)}%`,
                            backgroundColor: step.color
                              ? `color-mix(in srgb, ${step.color} 18%, transparent)`
                              : undefined,
                          }}
                        >
                          <span className="whitespace-nowrap text-sm font-medium">
                            {step.name}
                          </span>
                        </div>
                      </div>
                      <div className="w-28 shrink-0 text-right">
                        <span className="text-sm font-semibold tabular-nums">
                          {step.count}
                        </span>
                        <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                          {step.pctOfTotal}%
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Why leads are lost (RCA) ───────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Ban className="h-4 w-4 text-destructive" />
              Why leads are lost
            </CardTitle>
            <CardDescription>
              {funnel?.lost.count ?? 0} lost · {funnel?.lost.pctOfTotal ?? 0}% of
              all leads
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!funnel || funnel.lost.reasons.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No disqualification reasons recorded in{" "}
                {resolved.label.toLowerCase()}.
              </p>
            ) : (
              <ul className="space-y-3">
                {funnel.lost.reasons.map((r) => {
                  const pct =
                    funnel.lost.count > 0
                      ? Math.round((r.count / funnel.lost.count) * 100)
                      : 0;
                  return (
                    <li key={`${r.l1}-${r.l3}`}>
                      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate">{r.l3}</span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {r.count} · {pct}%
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted/40">
                        <div
                          className="h-full rounded-full bg-destructive/50"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {r.l1}
                      </p>
                    </li>
                  );
                })}
                {funnel.lost.unclassified > 0 && (
                  <li className="border-t pt-2 text-xs text-muted-foreground">
                    {funnel.lost.unclassified} lost{" "}
                    {funnel.lost.unclassified === 1 ? "lead" : "leads"} without a
                    reason yet — record them from the lead detail.
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {planned.map((p) => (
          <Card key={p.title}>
            <CardHeader>
              <Badge variant="outline" className="w-fit">
                In development
              </Badge>
              <CardTitle className="flex items-center gap-2 text-base">
                <p.icon className="h-4 w-4 text-primary" />
                {p.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-sm leading-relaxed">
                {p.body}
              </CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
