import { Badge } from "@/components/ui/badge";
import { ContactQueue } from "@/components/app/contact-queue";
import {
  FOLLOW_UP_AFTER_DAYS,
  getContactQueue,
  getWorkspaceContext,
} from "@/lib/data";

export const dynamic = "force-dynamic";

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
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {active ? `${active.name} — Contact Queue` : "Contact Queue"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Work the list top to bottom — follow-ups come back after{" "}
            {FOLLOW_UP_AFTER_DAYS} days without a resolution.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="destructive">{queue.followUpCount} follow-ups due</Badge>
          <Badge variant="secondary">{queue.newCount} new</Badge>
        </div>
      </div>

      <ContactQueue data={queue} />
    </div>
  );
}
