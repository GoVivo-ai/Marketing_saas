import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DateRangeSelect } from "@/components/app/date-range-select";
import { getLeadRows, getWorkspaceContext } from "@/lib/data";
import { LeadsTable } from "./leads-table";

export const dynamic = "force-dynamic";

const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All time" },
];
const DEFAULT_RANGE = "all";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range } = await searchParams;
  const selected = RANGES.some((r) => r.value === range) ? range! : DEFAULT_RANGE;
  const days = selected === "all" ? undefined : Number(selected);
  const rangeLabel = RANGES.find((r) => r.value === selected)!.label;

  const { active } = await getWorkspaceContext();
  const rows = active ? await getLeadRows(active.id, { days }) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {active ? `${active.name} — Leads` : "Unified Lead Inbox"}
          </h1>
          <p className="text-sm text-muted-foreground">
            One source of truth for marketing and operations — no more duplicated
            spreadsheets.
          </p>
        </div>
        <DateRangeSelect options={RANGES} defaultValue={DEFAULT_RANGE} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Incoming leads</CardTitle>
          <CardDescription>
            Synced from Meta Lead Ads · {rangeLabel} · {rows.length} total
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {days != null
                ? `No leads in the ${rangeLabel.toLowerCase()}. Try a wider range.`
                : "No leads synced yet. They will appear here after the first sync of a connected account."}
            </p>
          ) : (
            <LeadsTable rows={rows} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
