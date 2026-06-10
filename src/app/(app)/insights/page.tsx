import { Sparkles, AlertTriangle, Lightbulb, CalendarCheck } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { demoInsights } from "@/lib/demo-data";

const kindMeta = {
  anomaly: { icon: AlertTriangle, label: "Anomaly" },
  recommendation: { icon: Lightbulb, label: "Recommendation" },
  weekly_summary: { icon: CalendarCheck, label: "Weekly summary" },
  forecast: { icon: Sparkles, label: "Forecast" },
} as const;

export default function InsightsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI Insights</h1>
        <p className="text-sm text-muted-foreground">
          The analyst engine reviews every campaign daily: anomalies, scaling
          opportunities and a weekly executive summary — before anyone asks.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {demoInsights.map((insight) => {
          const meta = kindMeta[insight.kind];
          const Icon = meta.icon;
          return (
            <Card key={insight.title}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <Badge
                    variant={insight.severity === "critical" ? "destructive" : "secondary"}
                    className="gap-1"
                  >
                    <Icon className="h-3 w-3" />
                    {meta.label}
                  </Badge>
                  <span className="text-xs text-muted-foreground">Today, 6:00 AM</span>
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

        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" />
              Ask your data
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CardDescription className="text-sm leading-relaxed">
              Coming next: a chat interface where anyone on the team — or the
              client — can ask questions in plain language (&ldquo;Which campaign
              brought the cheapest qualified leads last month?&rdquo;) and get
              answers computed from live data.
            </CardDescription>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
