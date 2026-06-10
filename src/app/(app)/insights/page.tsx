import { formatDistanceToNow } from "date-fns";
import { desc, eq } from "drizzle-orm";
import { Sparkles, AlertTriangle, Lightbulb, CalendarCheck } from "lucide-react";
import { db, schema } from "@/lib/db";
import { getWorkspaceContext } from "@/lib/data";
import { GenerateInsightsButton } from "@/components/app/generate-insights-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

const kindMeta = {
  anomaly: { icon: AlertTriangle, label: "Anomaly" },
  recommendation: { icon: Lightbulb, label: "Recommendation" },
  weekly_summary: { icon: CalendarCheck, label: "Weekly summary" },
  forecast: { icon: Sparkles, label: "Forecast" },
} as const;

export default async function InsightsPage() {
  const { active } = await getWorkspaceContext();

  const insights = active
    ? await db()
        .select({
          id: schema.aiInsights.id,
          kind: schema.aiInsights.kind,
          severity: schema.aiInsights.severity,
          title: schema.aiInsights.title,
          body: schema.aiInsights.body,
          createdAt: schema.aiInsights.createdAt,
        })
        .from(schema.aiInsights)
        .where(eq(schema.aiInsights.workspaceId, active.id))
        .orderBy(desc(schema.aiInsights.createdAt))
        .limit(20)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {active ? `${active.name} — AI Insights` : "AI Insights"}
          </h1>
          <p className="text-sm text-muted-foreground">
            The analyst engine reviews synced campaign data: anomalies, scaling
            opportunities and executive summaries.
          </p>
        </div>
        <GenerateInsightsButton />
      </div>

      {insights.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No insights yet. Click &ldquo;Generate insights&rdquo; to analyze the
            last 14 days of synced data for this workspace.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {insights.map((insight) => {
            const meta = kindMeta[insight.kind] ?? kindMeta.recommendation;
            const Icon = meta.icon;
            return (
              <Card key={insight.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <Badge
                      variant={insight.severity === "critical" ? "destructive" : "secondary"}
                      className="gap-1"
                    >
                      <Icon className="h-3 w-3" />
                      {meta.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(insight.createdAt, { addSuffix: true })}
                    </span>
                  </div>
                  <CardTitle className="text-base leading-snug">{insight.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm leading-relaxed">
                    {insight.body}
                  </CardDescription>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
