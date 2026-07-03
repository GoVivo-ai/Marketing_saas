import { Card, CardContent } from "@/components/ui/card";
import { ContactQueue } from "@/components/app/contact-queue";
import { LeadsFilter } from "@/components/app/leads-filter";
import {
  FOLLOW_UP_AFTER_DAYS,
  getContactQueue,
  getQueueAdsetOptions,
  getWorkspaceContext,
} from "@/lib/data";

export const dynamic = "force-dynamic";

/** Stat tile matching the dashboard KPI cards (no delta — point-in-time). */
function StatCard({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <Card>
      <CardContent className="pt-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
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
  searchParams: Promise<{ adset?: string }>;
}) {
  const sp = await searchParams;
  const adsetId = sp.adset ?? null;

  const { active } = await getWorkspaceContext();
  const [queue, adsets] = active
    ? await Promise.all([
        getContactQueue(active.id, { adsetId }),
        getQueueAdsetOptions(active.id),
      ])
    : [
        { items: [], total: 0, newCount: 0, followUpCount: 0, coolingDown: 0 },
        [],
      ];

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
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="Follow-ups due"
          value={queue.followUpCount}
          hint={`No resolution after ${FOLLOW_UP_AFTER_DAYS}+ days`}
        />
        <StatCard label="New leads" value={queue.newCount} hint="Never contacted" />
        <StatCard
          label="Waiting"
          value={queue.coolingDown}
          hint="Contacted — inside the follow-up window"
        />
      </div>

      {/* Keyed by the filter so a slice change resets the client-side list. */}
      <ContactQueue key={adsetId ?? "all"} data={queue} />
    </div>
  );
}
