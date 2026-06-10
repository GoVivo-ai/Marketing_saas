import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const platforms = [
  {
    name: "Meta Ads",
    description: "Facebook & Instagram campaigns, insights and lead forms",
    status: "available" as const,
    detail: "OAuth connect flow — Phase 1",
  },
  {
    name: "Google Ads",
    description: "Search, Display, YouTube and Performance Max",
    status: "planned" as const,
    detail: "Phase 2",
  },
  {
    name: "TikTok Ads",
    description: "TikTok campaign performance and lead forms",
    status: "planned" as const,
    detail: "Phase 3",
  },
  {
    name: "LinkedIn Ads",
    description: "B2B campaigns and Lead Gen Forms",
    status: "planned" as const,
    detail: "Phase 3",
  },
];

export default function ConnectionsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        <p className="text-sm text-muted-foreground">
          Connect this workspace&apos;s ad accounts. Tokens are stored encrypted
          and scoped to the workspace.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {platforms.map((p) => (
          <Card key={p.name}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{p.name}</CardTitle>
                <Badge variant={p.status === "available" ? "default" : "secondary"}>
                  {p.status === "available" ? "Available" : p.detail}
                </Badge>
              </div>
              <CardDescription>{p.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button disabled={p.status !== "available"} variant="outline">
                Connect account
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
