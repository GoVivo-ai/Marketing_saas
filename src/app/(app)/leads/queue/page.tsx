import { Card, CardContent } from "@/components/ui/card";
import { ContactQueue } from "@/components/app/contact-queue";
import {
  FOLLOW_UP_AFTER_DAYS,
  getContactQueue,
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
export default async function ContactQueuePage() {
  const { active } = await getWorkspaceContext();
  const queue = active
    ? await getContactQueue(active.id)
    : { items: [], total: 0, newCount: 0, followUpCount: 0, coolingDown: 0 };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {active ? `${active.name} — Contact Queue` : "Contact Queue"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Work the list top to bottom — the queue puts overdue follow-ups first,
          then new leads by score.
        </p>
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

      <ContactQueue data={queue} />
    </div>
  );
}
