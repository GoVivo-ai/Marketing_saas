import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { ContactQueue } from "@/components/app/contact-queue";
import { WaitingList } from "@/components/app/waiting-list";
import { DateRangePicker } from "@/components/app/date-range-picker";
import { LeadsFilter, LeadsMultiFilter } from "@/components/app/leads-filter";
import { LeadsSearch } from "@/components/app/leads-search";
import {
  FOLLOW_UP_AFTER_DAYS,
  getContactQueue,
  getQueueAdsetOptions,
  getQueueGeoOptions,
  getWorkspaceCriteria,
  getWorkspaceContext,
} from "@/lib/data";
import { resolveDateRange } from "@/lib/date-range";
import { getScoreAutomation } from "@/lib/automations";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All time" },
];
const DEFAULT_RANGE = "all";

/**
 * Stat tile matching the dashboard KPI cards (no delta — point-in-time).
 * When `href` is given the whole tile is a link that filters the queue to that
 * bucket; `active` highlights the currently-applied filter.
 */
function StatCard({
  label,
  value,
  hint,
  href,
  active,
}: {
  label: string;
  value: number;
  hint: string;
  href?: string;
  active?: boolean;
}) {
  const body = (
    <CardContent className="pt-1">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </CardContent>
  );
  if (!href) return <Card>{body}</Card>;
  return (
    <Card
      className={cn(
        "transition-colors hover:border-primary/60",
        active && "border-primary ring-1 ring-primary",
      )}
    >
      <Link href={href} scroll={false} className="block">
        {body}
      </Link>
    </Card>
  );
}

/**
 * The ops working view: an ordered "who to contact next" queue — overdue
 * follow-ups first, then untouched leads by score — with one-click outcome
 * logging. The Leads table stays the browsing/audit surface; this is the
 * surface agents live in while calling.
 */
export default async function ContactQueuePage({
  searchParams,
}: {
  searchParams: Promise<{
    adset?: string;
    state?: string;
    city?: string;
    q?: string;
    range?: string;
    from?: string;
    to?: string;
    filter?: string;
  }>;
}) {
  const sp = await searchParams;
  const adsetId = sp.adset ?? null;
  // Multi-select location filters — comma-separated in the URL, absent = all.
  const states = sp.state ? sp.state.split(",").filter(Boolean) : [];
  const cities = sp.city ? sp.city.split(",").filter(Boolean) : [];
  const q = sp.q?.trim() || null;
  const filter =
    sp.filter === "follow_up" || sp.filter === "new" || sp.filter === "waiting"
      ? sp.filter
      : null;
  const resolved = resolveDateRange(sp, {
    presets: [7, 30, 90],
    defaultPreset: DEFAULT_RANGE,
    allowAllTime: true,
  });

  const { active } = await getWorkspaceContext();
  // Score-automation rule: when it flags leads in the queue, matching leads
  // show the configured script on their card.
  const automation = active ? await getScoreAutomation(active.id) : null;
  const queueAutomation =
    automation?.enabled && automation.action === "queue"
      ? {
          direction: automation.direction,
          threshold: automation.threshold,
          message: automation.message,
        }
      : null;
  const [queue, adsets, geo, workspaceCriteria] = active
    ? await Promise.all([
        getContactQueue(active.id, {
          adsetId,
          regions: states,
          cities,
          q,
          start: resolved.start,
          end: resolved.end,
        }),
        getQueueAdsetOptions(active.id),
        getQueueGeoOptions(active.id),
        getWorkspaceCriteria(active.id),
      ])
    : [
        {
          items: [],
          total: 0,
          newCount: 0,
          followUpCount: 0,
          coolingDown: 0,
          waiting: [],
        },
        [],
        [],
        null,
      ];

  // Location filter options: states from every geo pair; cities narrowed to
  // the selected states (cascading, like the campaign explorer).
  const stateOptions = [
    ...new Set(geo.map((g) => g.region).filter(Boolean)),
  ].sort() as string[];
  const cityOptions = [
    ...new Set(
      geo
        .filter(
          (g) =>
            states.length === 0 || (g.region && states.includes(g.region)),
        )
        .map((g) => g.city)
        .filter(Boolean),
    ),
  ].sort() as string[];

  // Clicking a stat tile filters the working queue to that bucket. The tiles
  // keep showing the full totals; only the queue below narrows.
  const viewData = filter
    ? { ...queue, items: queue.items.filter((i) => i.due === filter) }
    : queue;

  const hrefWith = (f: string | null) => {
    const p = new URLSearchParams();
    if (adsetId) p.set("adset", adsetId);
    if (sp.q) p.set("q", sp.q);
    if (sp.state) p.set("state", sp.state);
    if (sp.city) p.set("city", sp.city);
    if (sp.range) p.set("range", sp.range);
    if (sp.from) p.set("from", sp.from);
    if (sp.to) p.set("to", sp.to);
    if (f) p.set("filter", f);
    const qs = p.toString();
    return `/leads/queue${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {active ? `${active.name} — Contact Queue` : "Contact Queue"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Work the list top to bottom — the queue puts overdue follow-ups first,
            then new leads by score.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LeadsSearch initialValue={q ?? ""} />
          {/* Slice today's session to one ad set (e.g. only Redondo Beach). */}
          <LeadsFilter
            param="adset"
            icon="adset"
            title="Ad set"
            allLabel="All ad sets"
            activeValue={adsetId}
            options={adsets.map((a) => ({
              value: a.id,
              label: `${a.label} (${a.count})`,
            }))}
          />
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

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="Follow-ups due"
          value={queue.followUpCount}
          hint={`No resolution after ${FOLLOW_UP_AFTER_DAYS}+ days`}
          href={hrefWith("follow_up")}
          active={filter === "follow_up"}
        />
        <StatCard
          label="New leads"
          value={queue.newCount}
          hint="Never contacted"
          href={hrefWith("new")}
          active={filter === "new"}
        />
        <StatCard
          label="Waiting"
          value={queue.coolingDown}
          hint="Contacted — inside the follow-up window"
          href={hrefWith("waiting")}
          active={filter === "waiting"}
        />
      </div>

      {filter && (
        <div className="flex items-center gap-3 text-sm">
          <span className="font-medium">
            {filter === "follow_up"
              ? `Showing follow-ups only (${viewData.items.length})`
              : filter === "new"
                ? `Showing new leads only (${viewData.items.length})`
                : `Showing waiting leads (${queue.waiting.length})`}
          </span>
          <Link href={hrefWith(null)} className="text-primary hover:underline">
            Show all
          </Link>
        </div>
      )}

      {filter === "waiting" ? (
        <WaitingList items={queue.waiting} />
      ) : (
        // Keyed by the filters so a slice change resets the client-side list.
        <ContactQueue
          key={`${adsetId ?? "all"}:${q ?? ""}:${sp.state ?? ""}:${sp.city ?? ""}:${resolved.label}:${filter ?? "all"}`}
          data={viewData}
          automation={queueAutomation}
          defaultCriteria={workspaceCriteria}
        />
      )}
    </div>
  );
}
