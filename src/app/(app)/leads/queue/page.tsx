import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { ContactQueue } from "@/components/app/contact-queue";
import { DateRangePicker } from "@/components/app/date-range-picker";
import { LeadsFilter } from "@/components/app/leads-filter";
import {
  FOLLOW_UP_AFTER_DAYS,
  getContactQueue,
  getQueueAdsetOptions,
  getWorkspaceContext,
} from "@/lib/data";
import { resolveDateRange } from "@/lib/date-range";
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
    range?: string;
    from?: string;
    to?: string;
    filter?: string;
  }>;
}) {
  const sp = await searchParams;
  const adsetId = sp.adset ?? null;
  const filter =
    sp.filter === "follow_up" || sp.filter === "new" ? sp.filter : null;
  const resolved = resolveDateRange(sp, {
    presets: [7, 30, 90],
    defaultPreset: DEFAULT_RANGE,
    allowAllTime: true,
  });

  const { active } = await getWorkspaceContext();
  const [queue, adsets] = active
    ? await Promise.all([
        getContactQueue(active.id, {
          adsetId,
          start: resolved.start,
          end: resolved.end,
        }),
        getQueueAdsetOptions(active.id),
      ])
    : [
        { items: [], total: 0, newCount: 0, followUpCount: 0, coolingDown: 0 },
        [],
      ];

  // Clicking a stat tile filters the working queue to that bucket. The tiles
  // keep showing the full totals; only the queue below narrows.
  const viewData = filter
    ? { ...queue, items: queue.items.filter((i) => i.due === filter) }
    : queue;

  const hrefWith = (f: string | null) => {
    const p = new URLSearchParams();
    if (adsetId) p.set("adset", adsetId);
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
          {/* Slice today's session to one ad set (e.g. only Redondo Beach). */}
          <LeadsFilter
            param="adset"
            icon="adset"
            allLabel="All ad sets"
            activeValue={adsetId}
            options={adsets.map((a) => ({
              value: a.id,
              label: `${a.label} (${a.count})`,
            }))}
          />
          <DateRangePicker
            presets={RANGES}
            defaultValue={DEFAULT_RANGE}
            label={resolved.label}
          />
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
        />
      </div>

      {filter && (
        <div className="flex items-center gap-3 text-sm">
          <span className="font-medium">
            {filter === "follow_up"
              ? `Showing follow-ups only (${viewData.items.length})`
              : `Showing new leads only (${viewData.items.length})`}
          </span>
          <Link href={hrefWith(null)} className="text-primary hover:underline">
            Show all
          </Link>
        </div>
      )}

      {/* Keyed by the filters so a slice change resets the client-side list. */}
      <ContactQueue
        key={`${adsetId ?? "all"}:${resolved.label}:${filter ?? "all"}`}
        data={viewData}
      />
    </div>
  );
}
