import { FileBarChart, Mail, MessageCircle } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Automated client-facing reporting — replaces the manual Excel master sheet
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {planned.map((p) => (
          <Card key={p.title}>
            <CardHeader>
              <Badge variant="outline" className="w-fit">In development</Badge>
              <CardTitle className="flex items-center gap-2 text-base">
                <p.icon className="h-4 w-4 text-primary" />
                {p.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-sm leading-relaxed">{p.body}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
