"use server";

import { and, asc, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getWorkspaceContext } from "@/lib/data";

export interface PendingCallback {
  leadId: string;
  name: string;
  phone: string | null;
  campaign: string | null;
  callBackAt: Date;
  /** Who promised the lead the call — the header shows the agent's own. */
  scheduledBy: string | null;
}

/**
 * The current agent's pending callbacks in the active workspace: leads with
 * a callback time that the agent scheduled (latest "Callback scheduled"
 * note is theirs) or owns, still open, and not older than a day past due —
 * anything older is a missed callback the queue already surfaces.
 */
export async function listMyCallbacks(): Promise<PendingCallback[]> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Unauthorized");
  const { active } = await getWorkspaceContext();
  if (!active) return [];

  const schedulerSql = sql<string | null>`(
    select e.user_id from lead_events e
    where e.lead_id = ${schema.leads.id} and e.type = 'note'
      and e.payload ? 'callbackAt' and e.user_id is not null
    order by e.created_at desc limit 1
  )`;
  const rows = await db()
    .select({
      leadId: schema.leads.id,
      name: schema.leads.name,
      phone: schema.leads.phone,
      campaign: schema.campaigns.name,
      callBackAt: schema.leads.callBackAt,
      scheduledBy: schedulerSql,
    })
    .from(schema.leads)
    .leftJoin(schema.campaigns, eq(schema.leads.campaignId, schema.campaigns.id))
    .where(
      and(
        eq(schema.leads.workspaceId, active.id),
        isNotNull(schema.leads.callBackAt),
        gt(schema.leads.callBackAt, sql`now() - interval '1 day'`),
        isNull(schema.leads.disqualL1),
        or(eq(schema.leads.assignedToId, userId), sql`${schedulerSql} = ${userId}`),
      ),
    )
    .orderBy(asc(schema.leads.callBackAt))
    .limit(50);
  return rows
    .filter((r): r is typeof r & { callBackAt: Date } => r.callBackAt != null)
    .map((r) => ({
      leadId: r.leadId,
      name: r.name ?? "Unknown",
      phone: r.phone,
      campaign: r.campaign,
      callBackAt: r.callBackAt,
      scheduledBy: r.scheduledBy,
    }));
}
