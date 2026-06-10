import { Sparkles, AlertTriangle, Info } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/app/kpi-card";
import { PerformanceChart } from "@/components/app/performance-chart";
import { demoKpis, demoCampaigns, demoInsights } from "@/lib/demo-data";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default function DashboardPage() {
  const topCampaigns = demoCampaigns.filter((c) => c.spend > 0).slice(0, 4);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">
          Last 7 days · All platforms · Synced 12 minutes ago
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Ad Spend" value={usd(demoKpis.spend.value)} deltaPct={demoKpis.spend.deltaPct} invertColors />
        <KpiCard label="Leads" value={String(demoKpis.leads.value)} deltaPct={demoKpis.leads.deltaPct} />
        <KpiCard label="Cost per Lead" value={usd(demoKpis.cpl.value)} deltaPct={demoKpis.cpl.deltaPct} invertColors />
        <KpiCard label="CTR" value={`${demoKpis.ctr.value}%`} deltaPct={demoKpis.ctr.deltaPct} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Spend & Leads — last 30 days</CardTitle>
            <CardDescription>Daily performance across all connected platforms</CardDescription>
          </CardHeader>
          <CardContent>
            <PerformanceChart />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              AI Insights
            </CardTitle>
            <CardDescription>Generated this morning by the analyst engine</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {demoInsights.map((insight) => (
              <div key={insight.title} className="rounded-lg border p-3">
                <div className="flex items-start gap-2">
                  {insight.severity === "critical" ? (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                  ) : (
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  )}
                  <p className="text-sm font-medium leading-snug">{insight.title}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Top campaigns</CardTitle>
          <CardDescription>By spend, last 7 days</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {topCampaigns.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-lg border p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{c.name}</p>
                <p className="text-xs text-muted-foreground">
                  {c.platform === "meta" ? "Meta" : "Google Ads"} · {c.objective}
                </p>
              </div>
              <div className="flex items-center gap-6 text-sm">
                <div className="text-right">
                  <p className="font-medium">{usd(c.spend)}</p>
                  <p className="text-xs text-muted-foreground">spend</p>
                </div>
                <div className="text-right">
                  <p className="font-medium">{c.leads}</p>
                  <p className="text-xs text-muted-foreground">leads</p>
                </div>
                <div className="w-20 text-right">
                  <p className="font-medium">{c.cpl ? usd(c.cpl) : "—"}</p>
                  <p className="text-xs text-muted-foreground">CPL</p>
                </div>
                <Badge variant={c.status === "ACTIVE" ? "default" : "secondary"}>
                  {c.status}
                </Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
