import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DateRangePicker } from "@/components/app/date-range-picker";
import { Pagination } from "@/components/app/pagination";
import { getLeadsPage, getWorkspaceContext } from "@/lib/data";
import { resolveDateRange } from "@/lib/date-range";
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
  searchParams: Promise<{ range?: string; from?: string; to?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const resolved = resolveDateRange(sp, {
    presets: [7, 30, 90],
    defaultPreset: DEFAULT_RANGE,
    allowAllTime: true,
  });
  const requestedPage = Math.max(1, Number(sp.page) || 1);

  const { active } = await getWorkspaceContext();
  const result = active
    ? await getLeadsPage(active.id, {
        start: resolved.start,
        end: resolved.end,
        page: requestedPage,
      })
    : { rows: [], total: 0, page: 1, pageSize: 25, totalPages: 1 };

  const isFiltered = resolved.start != null;

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
        <DateRangePicker
          presets={RANGES}
          defaultValue={DEFAULT_RANGE}
          label={resolved.label}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Incoming leads</CardTitle>
          <CardDescription>
            Synced from Meta Lead Ads · {resolved.label} · {result.total} total
          </CardDescription>
        </CardHeader>
        <CardContent>
          {result.total === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {isFiltered
                ? `No leads in ${resolved.label.toLowerCase()}. Try a wider range.`
                : "No leads synced yet. They will appear here after the first sync of a connected account."}
            </p>
          ) : (
            <>
              <LeadsTable rows={result.rows} />
              <Pagination page={result.page} totalPages={result.totalPages} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
