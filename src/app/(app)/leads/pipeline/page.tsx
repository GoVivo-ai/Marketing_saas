import {
  getWorkspaceContext,
  getPipeline,
  getWorkspaceGeoOptions,
} from "@/lib/data";
import { canManageWorkspace } from "@/lib/permissions";
import { resolveDateRange } from "@/lib/date-range";
import { PipelineBoard } from "@/components/app/pipeline-board";
import { LeadsMultiFilter } from "@/components/app/leads-filter";
import { DateRangePicker } from "@/components/app/date-range-picker";

export const dynamic = "force-dynamic";

const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All time" },
];
const DEFAULT_RANGE = "all";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string;
    from?: string;
    to?: string;
    state?: string;
    city?: string;
  }>;
}) {
  const { active } = await getWorkspaceContext();
  if (!active) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
        <p className="text-sm text-muted-foreground">No workspace selected.</p>
      </div>
    );
  }

  const sp = await searchParams;
  const resolved = resolveDateRange(sp, {
    presets: [7, 30, 90],
    defaultPreset: DEFAULT_RANGE,
    allowAllTime: true,
  });
  // Multi-select location filters — comma-separated in the URL, absent = all.
  const states = sp.state ? sp.state.split(",").filter(Boolean) : [];
  const cities = sp.city ? sp.city.split(",").filter(Boolean) : [];

  const [pipeline, canManage, geo] = await Promise.all([
    getPipeline(active.id, {
      regions: states,
      cities,
      start: resolved.start,
      end: resolved.end,
    }),
    canManageWorkspace(active.id),
    getWorkspaceGeoOptions(active.id),
  ]);

  const stateOptions = [
    ...new Set(geo.map((g) => g.region).filter(Boolean)),
  ].sort() as string[];
  const cityOptions = [
    ...new Set(
      geo
        .filter(
          (g) => states.length === 0 || (g.region && states.includes(g.region)),
        )
        .map((g) => g.city)
        .filter(Boolean),
    ),
  ].sort() as string[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {active.name} — Pipeline
          </h1>
          <p className="text-sm text-muted-foreground">
            Your sales funnel — move each lead through the stages as you work it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LeadsMultiFilter
            param="state"
            icon="state"
            title="State"
            allLabel="All states"
            activeValues={states}
            options={stateOptions.map((s) => ({ value: s, label: s }))}
          />
          <LeadsMultiFilter
            param="city"
            icon="city"
            title="City"
            allLabel="All cities"
            activeValues={cities}
            options={cityOptions.map((c) => ({ value: c, label: c }))}
          />
          <label className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Created
            </span>
            <DateRangePicker
              presets={RANGES}
              defaultValue={DEFAULT_RANGE}
              label={resolved.label}
            />
          </label>
        </div>
      </div>

      <PipelineBoard
        /* The board keeps its own drag state — remount it when the slice
           changes so it doesn't render stale cards. */
        key={`${sp.state ?? ""}:${sp.city ?? ""}:${resolved.label}`}
        workspaceId={active.id}
        stages={pipeline.stages}
        cardsByStage={pipeline.cardsByStage}
        counts={pipeline.counts}
        cap={pipeline.cap}
        canManage={canManage}
      />
    </div>
  );
}
