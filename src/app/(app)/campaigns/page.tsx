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
import Link from "next/link";
import { TrendingDown, TrendingUp, Minus, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { DateRangePicker } from "@/components/app/date-range-picker";
import { SyncNowButton } from "@/components/app/sync-now-button";
import { getCampaignRows, getWorkspaceContext } from "@/lib/data";
import { resolveDateRange } from "@/lib/date-range";

export const dynamic = "force-dynamic";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];
const DEFAULT_RANGE = "30";

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const resolved = resolveDateRange(sp, {
    presets: [7, 30, 90],
    defaultPreset: DEFAULT_RANGE,
    allowAllTime: false,
  });
  const { active } = await getWorkspaceContext();
  const rows = active
    ? await getCampaignRows(active.id, { start: resolved.start!, end: resolved.end! })
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {active ? `${active.name} — Campaigns` : "Campaigns"}
          </h1>
          <p className="text-sm text-muted-foreground">
            All campaigns across platforms, normalized into one view
          </p>
        </div>
        <div className="flex items-center gap-2">
          {active && <SyncNowButton workspaceId={active.id} />}
          <DateRangePicker
            presets={RANGES}
            defaultValue={DEFAULT_RANGE}
            label={resolved.label}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All campaigns</CardTitle>
          <CardDescription>
            {resolved.label} · CPL trend compares the recent half of the range
            vs the earlier half
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
                  <TableRow key={c.id} className="group">
                    <TableCell className="max-w-[260px]">
                      <Link
                        href={`/campaigns/${c.id}`}
                        className="flex items-center gap-1 font-medium hover:underline"
                        title="View ad sets by city"
                      >
                        <span className="truncate">{c.name}</span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </Link>
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
                          c.trend < 0 && "text-success",
                          c.trend > 0 && "text-destructive",
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
