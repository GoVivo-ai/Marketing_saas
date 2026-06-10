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
import { Badge } from "@/components/ui/badge";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { getCampaignRows, getWorkspaceContext } from "@/lib/data";

export const dynamic = "force-dynamic";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default async function CampaignsPage() {
  const { active } = await getWorkspaceContext();
  const rows = active ? await getCampaignRows(active.id) : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {active ? `${active.name} — Campaigns` : "Campaigns"}
        </h1>
        <p className="text-sm text-muted-foreground">
          All campaigns across platforms, normalized into one view
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All campaigns</CardTitle>
          <CardDescription>
            Last 30 days · CPL trend compares the last 15 days vs the 15 before
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No campaigns synced yet. Connect an ad account in Settings →
              Connections.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                  <TableHead className="text-right">Impressions</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">CPL</TableHead>
                  <TableHead className="text-right">CPL trend</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="max-w-[260px]">
                      <p className="truncate font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.objective ?? "—"}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {c.platform === "meta" ? "Meta" : "Google Ads"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={c.status === "ACTIVE" ? "default" : "secondary"}>
                        {c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{usd(c.spend)}</TableCell>
                    <TableCell className="text-right">
                      {c.impressions.toLocaleString("en-US")}
                    </TableCell>
                    <TableCell className="text-right">
                      {c.clicks.toLocaleString("en-US")}
                    </TableCell>
                    <TableCell className="text-right">{c.leads}</TableCell>
                    <TableCell className="text-right">{c.cpl ? usd(c.cpl) : "—"}</TableCell>
                    <TableCell className="text-right">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 text-sm font-medium",
                          c.trend < 0 && "text-emerald-500",
                          c.trend > 0 && "text-red-500",
                          c.trend === 0 && "text-muted-foreground",
                        )}
                      >
                        {c.trend < 0 ? (
                          <TrendingDown className="h-4 w-4" />
                        ) : c.trend > 0 ? (
                          <TrendingUp className="h-4 w-4" />
                        ) : (
                          <Minus className="h-4 w-4" />
                        )}
                        {c.trend === 0 ? "—" : `${Math.abs(c.trend).toFixed(1)}%`}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
