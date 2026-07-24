import { desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  fetchCallLog,
  RingCentralNotConnectedError,
} from "@/lib/integrations/ringcentral";

/**
 * Mirrors each connected user's RingCentral call log into `call_logs` and
 * matches every call to a lead by phone number. Runs from the nightly cron
 * and from the "Sync calls" button on the Agent Activity report.
 */

export interface CallLogSyncStats {
  users: number;
  calls: number;
  matched: number;
  errors: string[];
}

/** First sync reaches back 90 days; later runs re-fetch a 48h overlap so
 *  in-progress calls picked up mid-call get their final duration/result. */
const FIRST_SYNC_DAYS = 90;
const OVERLAP_MS = 48 * 60 * 60 * 1000;

/** Last 10 digits — tolerant of +1/formatting differences between the ad
 *  platform's lead phone and RingCentral's E.164. */
export const phoneKey = (raw: string | null | undefined): string | null => {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-10) : null;
};

/** Newest lead whose phone ends in the same 10 digits, or null. */
export async function matchLeadByPhone(
  phone: string | null | undefined,
): Promise<{ leadId: string; workspaceId: string } | null> {
  const key = phoneKey(phone);
  if (!key) return null;
  const [lead] = await db()
    .select({ leadId: schema.leads.id, workspaceId: schema.leads.workspaceId })
    .from(schema.leads)
    .where(
      sql`right(regexp_replace(${schema.leads.phone}, '\\D', '', 'g'), 10) = ${key}`,
    )
    .orderBy(desc(schema.leads.createdAt))
    .limit(1);
  return lead ?? null;
}

/** phone → { leadId, workspaceId }, newest lead wins per number. */
async function buildLeadPhoneIndex(): Promise<
  Map<string, { leadId: string; workspaceId: string }>
> {
  const rows = await db()
    .select({
      id: schema.leads.id,
      workspaceId: schema.leads.workspaceId,
      phone: schema.leads.phone,
      createdAt: schema.leads.createdAt,
    })
    .from(schema.leads)
    .where(isNotNull(schema.leads.phone))
    .orderBy(desc(schema.leads.createdAt));
  const index = new Map<string, { leadId: string; workspaceId: string }>();
  for (const r of rows) {
    const key = phoneKey(r.phone);
    // Rows arrive newest-first; keep the first (newest) lead per number.
    if (key && !index.has(key))
      index.set(key, { leadId: r.id, workspaceId: r.workspaceId });
  }
  return index;
}

async function syncUser(
  userId: string,
  leadIndex: Map<string, { leadId: string; workspaceId: string }>,
): Promise<{ calls: number; matched: number }> {
  const [last] = await db()
    .select({ startTime: schema.callLogs.startTime })
    .from(schema.callLogs)
    .where(eq(schema.callLogs.userId, userId))
    .orderBy(desc(schema.callLogs.startTime))
    .limit(1);

  const dateFrom = last
    ? new Date(last.startTime.getTime() - OVERLAP_MS)
    : new Date(Date.now() - FIRST_SYNC_DAYS * 24 * 60 * 60 * 1000);

  const records = await fetchCallLog(userId, { dateFrom });
  let matched = 0;
  for (const r of records) {
    // An outbound call's counterparty is `to`; inbound it's `from`.
    const counterparty = r.direction === "Inbound" ? r.from : r.to;
    const lead = leadIndex.get(phoneKey(counterparty) ?? "") ?? null;
    if (lead) matched++;
    await db()
      .insert(schema.callLogs)
      .values({
        userId,
        externalId: r.id,
        direction: r.direction,
        fromNumber: r.from,
        toNumber: r.to,
        startTime: r.startTime,
        durationSec: r.durationSec,
        result: r.result,
        leadId: lead?.leadId ?? null,
        workspaceId: lead?.workspaceId ?? null,
      })
      .onConflictDoUpdate({
        target: [schema.callLogs.userId, schema.callLogs.externalId],
        set: {
          durationSec: r.durationSec,
          result: r.result,
          leadId: lead?.leadId ?? null,
          workspaceId: lead?.workspaceId ?? null,
        },
      });
  }
  return { calls: records.length, matched };
}

/** Syncs every user who has RingCentral connected. Per-user failures are
 *  collected, not thrown — one expired token must not sink the rest. */
export async function syncAllCallLogs(): Promise<CallLogSyncStats> {
  const users = await db()
    .select({ id: schema.users.id, name: schema.users.name })
    .from(schema.users)
    .where(isNotNull(schema.users.rcAccessTokenEnc));

  const stats: CallLogSyncStats = {
    users: 0,
    calls: 0,
    matched: 0,
    errors: [],
  };
  if (users.length === 0) return stats;

  const leadIndex = await buildLeadPhoneIndex();
  for (const u of users) {
    try {
      const r = await syncUser(u.id, leadIndex);
      stats.users++;
      stats.calls += r.calls;
      stats.matched += r.matched;
    } catch (err) {
      if (err instanceof RingCentralNotConnectedError) continue; // token died — user must reconnect
      stats.errors.push(
        `${u.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return stats;
}
