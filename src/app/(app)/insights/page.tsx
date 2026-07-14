import { format, formatDistanceToNow } from "date-fns";
import { desc, eq } from "drizzle-orm";
import {
  Sparkles,
  AlertTriangle,
  Lightbulb,
  CalendarCheck,
  ArrowRight,
  History,
} from "lucide-react";
import { db, schema } from "@/lib/db";
import { getWorkspaceContext } from "@/lib/data";
import { requireFullAccess } from "@/lib/permissions";
import { GenerateInsightsButton } from "@/components/app/generate-insights-button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const kindMeta = {
  anomaly: { icon: AlertTriangle, label: "Anomaly" },
  recommendation: { icon: Lightbulb, label: "Recommendation" },
  weekly_summary: { icon: CalendarCheck, label: "Weekly summary" },
  forecast: { icon: Sparkles, label: "Forecast" },
} as const;

const severityRank = { critical: 0, warning: 1, info: 2 } as const;
const severityAccent = {
  critical: "border-l-destructive",
  warning: "border-l-amber-500",
  info: "border-l-primary/50",
} as const;

type Severity = keyof typeof severityRank;

export default async function InsightsPage() {
  const { active } = await getWorkspaceContext();
  await requireFullAccess(active?.id);

  const insights = active
    ? await db()
        .select({
          id: schema.aiInsights.id,
          kind: schema.aiInsights.kind,
          severity: schema.aiInsights.severity,
          title: schema.aiInsights.title,
          body: schema.aiInsights.body,
          data: schema.aiInsights.data,
          createdAt: schema.aiInsights.createdAt,
        })
        .from(schema.aiInsights)
        .where(eq(schema.aiInsights.workspaceId, active.id))
        .orderBy(desc(schema.aiInsights.createdAt))
        .limit(40)
    : [];

  // One click on "Generate" persists a batch with near-identical timestamps;
  // the newest batch is the current analysis, the rest is history.
  const newest = insights[0]?.createdAt;
  const isLatestBatch = (d: Date) =>
    newest != null && newest.getTime() - d.getTime() < 2 * 60_000;
  const latest = insights
    .filter((i) => isLatestBatch(i.createdAt))
    .sort(
      (a, b) =>
        (severityRank[a.severity as Severity] ?? 2) -
        (severityRank[b.severity as Severity] ?? 2),
    );
  const earlier = insights.filter((i) => !isLatestBatch(i.createdAt));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {active ? `${active.name} — AI Insights` : "AI Insights"}
          </h1>
          <p className="text-sm text-muted-foreground">
            The analyst engine reads your campaigns, per-city CPLs, plan pacing
            and pipeline — and tells you what to change, with numbers.
          </p>
        </div>
        <GenerateInsightsButton />
      </div>

      {latest.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No insights yet. Click &ldquo;Generate insights&rdquo; to analyze
            this workspace&apos;s campaigns, cities, plan and pipeline.
          </CardContent>
        </Card>
      ) : (
        <section className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Latest analysis ·{" "}
            {formatDistanceToNow(latest[0].createdAt, { addSuffix: true })}
          </p>
          <div className="space-y-3">
            {latest.map((insight) => {
              const meta = kindMeta[insight.kind] ?? kindMeta.recommendation;
              const Icon = meta.icon;
              const action = (insight.data as { action?: string } | null)?.action;
              return (
                <Card
                  key={insight.id}
                  className={cn(
                    "border-l-4",
                    severityAccent[insight.severity as Severity] ??
                      severityAccent.info,
                  )}
                >
                  <CardContent className="space-y-2.5 px-5 py-4">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          insight.severity === "critical"
                            ? "destructive"
                            : "secondary"
                        }
                        className="gap-1"
                      >
                        <Icon className="h-3 w-3" />
                        {meta.label}
                      </Badge>
                      {insight.severity === "warning" && (
                        <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                          Needs attention
                        </span>
                      )}
                    </div>
                    <h2 className="text-base font-semibold leading-snug">
                      {insight.title}
                    </h2>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {insight.body}
                    </p>
                    {action && (
                      <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm font-medium">
                        <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        {action}
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {earlier.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
            <History className="h-4 w-4" />
            Earlier insights ({earlier.length})
          </summary>
          <div className="mt-3 space-y-1.5">
            {earlier.map((insight) => {
              const meta = kindMeta[insight.kind] ?? kindMeta.recommendation;
              const Icon = meta.icon;
              return (
                <div
                  key={insight.id}
                  className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{insight.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {format(insight.createdAt, "MMM d, HH:mm")}
                  </span>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}
