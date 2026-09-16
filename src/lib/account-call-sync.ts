import { desc, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  fetchAccountCallLog,
  fetchAccountExtensions,
  isAccountSyncConfigured,
  jwtAccessToken,
  type RcExtension,
} from "@/lib/integrations/ringcentral";
import { phoneKey } from "@/lib/call-log-sync";

/**
 * Account-level call log sync.
 *
 * The per-user sync in call-log-sync.ts can only see the extension whose
 * owner connected OAuth — and nobody has. Everything in `call_logs` today
 * comes from the browser widget, which misses any call placed outside the
 * tab: measured at 11 of 55 for one agent on 2026-09-03, and the missing
 * ones were the long calls the KPIs are built on.
 *
 * This reads the whole company's log with one admin JWT instead, keyed on
 * the same telephonySessionId the widget reports, so the two writers land on
 * the same row: the widget gives immediacy, this gives completeness.
 */

const FIRST_SYNC_DAYS = 90;
/** Re-fetch this far back so calls captured mid-flight get final values. */
const OVERLAP_MS = 48 * 60 * 60 * 1000;

export interface ExtensionMapping {
  extensionId: string;
  extensionNumber: string | null;
  rcName: string | null;
  rcEmail: string | null;
  userId: string | null;
  userName: string | null;
  matchedBy: "auto" | "manual" | "unmatched";
}

export interface AccountSyncReport {
  dryRun: boolean;
  /** Null when the run was skipped for want of credentials. */
  skipped?: string;
  extensions: ExtensionMapping[];
  fetched: number;
  /** Rows that would be (or were) created, updated, or dropped on the floor. */
  created: number;
  updated: number;
  unmappedCalls: number;
  matchedToLeads: number;
  from: Date | null;
  to: Date | null;
}

/**
 * Accent-insensitive, so "María Alejandra" still finds "Maria Alejandra" —
 * RingCentral extensions are routinely typed without diacritics, and two of
 * the three agents on the phones have an accented name.
 */
const norm = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

/**
 * Pairs RingCentral extensions with platform users: email first because it's
 * unique, then full name. Anything ambiguous is left unmatched on purpose —
 * a wrong guess credits one agent's calls to another, and that error is
 * invisible in the report it feeds.
 */
export async function reconcileExtensions(
  extensions: RcExtension[],
  opts: { dryRun: boolean },
): Promise<ExtensionMapping[]> {
  const users = await db()
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      rcOwnerId: schema.users.rcOwnerId,
    })
    .from(schema.users);

  const byEmail = new Map(users.filter((u) => u.email).map((u) => [norm(u.email), u]));
  const byOwnerId = new Map(
    users.filter((u) => u.rcOwnerId).map((u) => [String(u.rcOwnerId), u]),
  );
  // Names are not unique, so a name that belongs to two users matches neither.
  const nameCounts = new Map<string, number>();
  for (const u of users)
    nameCounts.set(norm(u.name), (nameCounts.get(norm(u.name)) ?? 0) + 1);
  const byName = new Map(
    users.filter((u) => nameCounts.get(norm(u.name)) === 1).map((u) => [norm(u.name), u]),
  );

  const existing = await db()
    .select({
      extensionId: schema.rcExtensions.extensionId,
      userId: schema.rcExtensions.userId,
      matchedBy: schema.rcExtensions.matchedBy,
    })
    .from(schema.rcExtensions);
  const existingByExt = new Map(existing.map((e) => [e.extensionId, e]));

  const out: ExtensionMapping[] = [];
  for (const ext of extensions) {
    const prior = existingByExt.get(ext.id);
    // A human's correction always wins over the matcher.
    if (prior?.matchedBy === "manual" && prior.userId) {
      const u = users.find((x) => x.id === prior.userId);
      out.push({
        extensionId: ext.id,
        extensionNumber: ext.extensionNumber,
        rcName: ext.name,
        rcEmail: ext.email,
        userId: prior.userId,
        userName: u?.name ?? null,
        matchedBy: "manual",
      });
      continue;
    }

    const hit =
      byOwnerId.get(ext.id) ??
      (ext.email ? byEmail.get(norm(ext.email)) : undefined) ??
      (ext.name ? byName.get(norm(ext.name)) : undefined) ??
      null;

    out.push({
      extensionId: ext.id,
      extensionNumber: ext.extensionNumber,
      rcName: ext.name,
      rcEmail: ext.email,
      userId: hit?.id ?? null,
      userName: hit?.name ?? null,
      matchedBy: hit ? "auto" : "unmatched",
    });
  }

  if (!opts.dryRun) {
    for (const m of out) {
      const fields = {
        extensionNumber: m.extensionNumber,
        rcName: m.rcName,
        rcEmail: m.rcEmail,
        userId: m.userId,
        updatedAt: new Date(),
      };
      await db()
        .insert(schema.rcExtensions)
        .values({ extensionId: m.extensionId, matchedBy: "auto", ...fields })
        .onConflictDoUpdate({
          target: [schema.rcExtensions.extensionId],
          set: {
            extensionNumber: fields.extensionNumber,
            rcName: fields.rcName,
            rcEmail: fields.rcEmail,
            updatedAt: fields.updatedAt,
            // Never overwrite a hand-made mapping with a guess.
            userId: sql`case when ${schema.rcExtensions.matchedBy} = 'manual'
                             then ${schema.rcExtensions.userId}
                             else ${m.userId} end`,
          },
        });
    }
  }
  return out;
}

/** phone → newest lead with that number, for attributing calls. */
async function buildLeadPhoneIndex(): Promise<
  Map<string, { leadId: string; workspaceId: string }>
> {
  const rows = await db()
    .select({
      id: schema.leads.id,
      workspaceId: schema.leads.workspaceId,
      phone: schema.leads.phone,
    })
    .from(schema.leads)
    .where(isNotNull(schema.leads.phone))
    .orderBy(desc(schema.leads.createdAt));
  const index = new Map<string, { leadId: string; workspaceId: string }>();
  for (const r of rows) {
    const key = phoneKey(r.phone);
    if (key && !index.has(key))
      index.set(key, { leadId: r.id, workspaceId: r.workspaceId });
  }
  return index;
}

/**
 * Pulls the company call log and mirrors it into `call_logs`.
 *
 * `dryRun` reports exactly what it would write without touching a row —
 * preview and production share one database, so the mapping has to be
 * provable before anything lands in the table the ops report reads.
 */
export async function syncAccountCallLogs(
  opts: { dryRun?: boolean; days?: number } = {},
): Promise<AccountSyncReport> {
  const dryRun = opts.dryRun ?? false;
  const empty: AccountSyncReport = {
    dryRun,
    extensions: [],
    fetched: 0,
    created: 0,
    updated: 0,
    unmappedCalls: 0,
    matchedToLeads: 0,
    from: null,
    to: null,
  };

  if (!(await isAccountSyncConfigured()))
    return { ...empty, skipped: "RINGCENTRAL_JWT is not set for this deployment" };

  const accessToken = await jwtAccessToken();
  const extensions = await fetchAccountExtensions(accessToken);
  const mappings = await reconcileExtensions(extensions, { dryRun });
  const userByExtension = new Map(
    mappings.filter((m) => m.userId).map((m) => [m.extensionId, m.userId!]),
  );

  // Resume from the newest synced call, minus the overlap.
  const [last] = await db()
    .select({ startTime: schema.callLogs.startTime })
    .from(schema.callLogs)
    .orderBy(desc(schema.callLogs.startTime))
    .limit(1);
  const dateFrom = opts.days
    ? new Date(Date.now() - opts.days * 86_400_000)
    : last
      ? new Date(last.startTime.getTime() - OVERLAP_MS)
      : new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000);

  const records = await fetchAccountCallLog(accessToken, { dateFrom });
  const leadIndex = await buildLeadPhoneIndex();

  // Which of these the table already holds, so the report can say "new" vs
  // "already there" without writing anything.
  const ids = records.map((r) => r.id);
  const known = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await db()
      .select({ externalId: schema.callLogs.externalId })
      .from(schema.callLogs)
      .where(inArray(schema.callLogs.externalId, ids.slice(i, i + 500)));
    for (const r of rows) known.add(r.externalId);
  }

  const report: AccountSyncReport = {
    ...empty,
    extensions: mappings,
    fetched: records.length,
    from: dateFrom,
    to: new Date(),
  };

  for (const r of records) {
    const userId = r.extensionId ? userByExtension.get(r.extensionId) : undefined;
    if (!userId) {
      // Nobody to attribute it to — counted, never written, since call_logs
      // requires a user.
      report.unmappedCalls++;
      continue;
    }
    const counterparty = r.direction === "Inbound" ? r.from : r.to;
    const lead = leadIndex.get(phoneKey(counterparty) ?? "") ?? null;
    if (lead) report.matchedToLeads++;
    if (known.has(r.id)) report.updated++;
    else report.created++;

    if (dryRun) continue;

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
          // The account log is authoritative over the widget's snapshot: the
          // widget often records a call before it ends, so its duration and
          // result are provisional.
          direction: r.direction,
          fromNumber: r.from,
          toNumber: r.to,
          startTime: r.startTime,
          durationSec: r.durationSec,
          result: r.result,
          leadId: lead?.leadId ?? null,
          workspaceId: lead?.workspaceId ?? null,
        },
      });
  }

  return report;
}
