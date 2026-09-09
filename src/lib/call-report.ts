import { and, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * Daily call performance per agent — the ops lead's RingCentral tracker,
 * computed from the mirrored `call_logs` instead of a hand-exported CSV.
 * Definitions follow the ops team's "Sistema de Análisis de Performance
 * Diario" doc (Sept 2026): KPIs per agent per day, plus two alert types
 * (inactivity gaps between calls, and hammering one number).
 *
 * Days are bucketed in the operation's timezone (the team calls California
 * drivers on California hours), not the server's UTC.
 */

/** The operation's local timezone for "what day was that call". */
export const CALL_REPORT_TZ = "America/Los_Angeles";

/** A conversation that actually happened: 2.5 minutes or more. */
export const REAL_CONVERSATION_SEC = 150;
/** Long enough to have been a profile walkthrough: 8 minutes or more. */
export const POSSIBLE_PROFILE_SEC = 480;
/** Gap between two consecutive calls that counts as inactivity. */
export const INACTIVITY_MIN = 10;
/** 3+ dials to the same number inside this window = hammering. */
export const REDIAL_WINDOW_MIN = 10;
export const REDIAL_MIN_ATTEMPTS = 3;

export type GapLevel = "warn" | "alert" | "critical";

/** 10–20 min ⚠️ · 20–30 min 🚨 · 30+ min critical (per the ops doc). */
export function gapLevel(minutes: number): GapLevel {
  if (minutes >= 30) return "critical";
  if (minutes >= 20) return "alert";
  return "warn";
}

export interface CallGap {
  from: Date;
  to: Date;
  minutes: number;
  level: GapLevel;
}

export interface Redial {
  number: string;
  leadName: string | null;
  /** Minutes between the first and the third dial. */
  windowMin: number;
  attempts: { at: Date; durationSec: number }[];
}

export interface LongCall {
  at: Date;
  number: string;
  leadName: string | null;
  durationSec: number;
}

export interface AgentDayRow {
  userId: string;
  name: string;
  /** YYYY-MM-DD in the operation's timezone. */
  day: string;
  firstCall: Date;
  lastCall: Date;
  /** Minutes between the first and the last call of the day. */
  spanMin: number;
  outbound: number;
  /** Distinct numbers dialed (outbound). */
  uniqueLeads: number;
  /** uniqueLeads ÷ outbound. */
  efficiencyPct: number | null;
  /** Outbound calls ≥ REAL_CONVERSATION_SEC. */
  realConversations: number;
  /** Outbound calls ≥ POSSIBLE_PROFILE_SEC. */
  possibleProfiles: number;
  /** realConversations ÷ outbound. */
  contactRatePct: number | null;
  inbound: number;
  inboundMissed: number;
  talkTimeSec: number;
  /** Leads this agent moved into Contractor Compliance that day. */
  profilesCreated: number;
  gaps: CallGap[];
  /** Sum of every inactivity gap, in minutes. */
  inactiveMin: number;
  redials: Redial[];
  longCalls: LongCall[];
}

export interface DailyCallReport {
  rows: AgentDayRow[];
  totals: {
    outbound: number;
    uniqueLeads: number;
    realConversations: number;
    possibleProfiles: number;
    profilesCreated: number;
    inboundMissed: number;
    /** Gaps at "alert" or worse across every agent-day. */
    alerts: number;
    redials: number;
  };
}

const CONNECTED_RESULTS = new Set(["Call connected", "Accepted", "Answered"]);

const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: CALL_REPORT_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
/** "2026-09-03" for the instant, in the operation's timezone. */
export const localDay = (d: Date): string => dayFmt.format(d);

const pct = (num: number, den: number): number | null =>
  den > 0 ? Math.round((num / den) * 100) : null;

export async function getDailyCallReport(
  workspaceId: string,
  opts: { start?: Date | null; end?: Date | null } = {},
): Promise<DailyCallReport> {
  // Every call the workspace's agents made, whether or not it matched one
  // of this client's leads — the tracker counts all dials. Calls matched to
  // the workspace also count for users who aren't members (agency staff).
  const members = db()
    .select({ userId: schema.workspaceMembers.userId })
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.workspaceId, workspaceId));
  const callFilters = [
    or(
      eq(schema.callLogs.workspaceId, workspaceId),
      inArray(schema.callLogs.userId, members),
    ),
  ];
  if (opts.start) callFilters.push(gte(schema.callLogs.startTime, opts.start));
  if (opts.end) callFilters.push(lte(schema.callLogs.startTime, opts.end));

  const ccFilters = [
    eq(schema.leads.workspaceId, workspaceId),
    eq(schema.leadEvents.type, "status_change"),
    sql`${schema.leadEvents.payload}->>'reason' = 'cc_activated'`,
  ];
  if (opts.start) ccFilters.push(gte(schema.leadEvents.createdAt, opts.start));
  if (opts.end) ccFilters.push(lte(schema.leadEvents.createdAt, opts.end));

  const [calls, activations] = await Promise.all([
    db()
      .select({
        userId: schema.callLogs.userId,
        userName: schema.users.name,
        direction: schema.callLogs.direction,
        toNumber: schema.callLogs.toNumber,
        fromNumber: schema.callLogs.fromNumber,
        startTime: schema.callLogs.startTime,
        durationSec: schema.callLogs.durationSec,
        result: schema.callLogs.result,
        leadName: schema.leads.name,
      })
      .from(schema.callLogs)
      .innerJoin(schema.users, eq(schema.callLogs.userId, schema.users.id))
      .leftJoin(schema.leads, eq(schema.callLogs.leadId, schema.leads.id))
      .where(and(...callFilters))
      .orderBy(schema.callLogs.startTime),
    db()
      .select({
        userId: schema.leadEvents.userId,
        createdAt: schema.leadEvents.createdAt,
      })
      .from(schema.leadEvents)
      .innerJoin(schema.leads, eq(schema.leadEvents.leadId, schema.leads.id))
      .where(and(...ccFilters)),
  ]);

  // Group calls per agent-day (calls arrive sorted by start time).
  type Call = (typeof calls)[number];
  const groups = new Map<string, { userId: string; name: string; day: string; calls: Call[] }>();
  for (const c of calls) {
    const day = localDay(c.startTime);
    const key = `${c.userId}|${day}`;
    let g = groups.get(key);
    if (!g) {
      g = { userId: c.userId, name: c.userName ?? "Unknown user", day, calls: [] };
      groups.set(key, g);
    }
    g.calls.push(c);
  }

  const activationsByKey = new Map<string, number>();
  for (const a of activations) {
    if (!a.userId) continue;
    const key = `${a.userId}|${localDay(a.createdAt)}`;
    activationsByKey.set(key, (activationsByKey.get(key) ?? 0) + 1);
  }

  const rows: AgentDayRow[] = [];
  for (const [key, g] of groups) {
    const outboundCalls = g.calls.filter((c) => c.direction === "Outbound");
    const inboundCalls = g.calls.filter((c) => c.direction === "Inbound");
    const first = g.calls[0].startTime;
    const last = g.calls[g.calls.length - 1].startTime;

    // Inactivity: gaps between consecutive calls (any direction). The
    // day's first and last call bound the shift — nothing is assumed
    // about official hours.
    const gaps: CallGap[] = [];
    for (let i = 1; i < g.calls.length; i++) {
      const prev = g.calls[i - 1];
      const cur = g.calls[i];
      // Measured from the end of the previous call, so a long
      // conversation never reads as inactivity.
      const prevEnd = prev.startTime.getTime() + prev.durationSec * 1000;
      const minutes = (cur.startTime.getTime() - prevEnd) / 60_000;
      if (minutes >= INACTIVITY_MIN)
        gaps.push({
          from: new Date(prevEnd),
          to: cur.startTime,
          minutes: Math.round(minutes),
          level: gapLevel(minutes),
        });
    }

    // Hammering: 3+ dials to one number with the 1st→3rd inside 10 min.
    const byNumber = new Map<string, Call[]>();
    for (const c of outboundCalls) {
      const n = c.toNumber ?? "";
      if (!n) continue;
      const list = byNumber.get(n) ?? [];
      list.push(c);
      byNumber.set(n, list);
    }
    const redials: Redial[] = [];
    for (const [number, list] of byNumber) {
      if (list.length < REDIAL_MIN_ATTEMPTS) continue;
      for (let i = 0; i + REDIAL_MIN_ATTEMPTS - 1 < list.length; i++) {
        const a = list[i];
        const c = list[i + REDIAL_MIN_ATTEMPTS - 1];
        const windowMin = (c.startTime.getTime() - a.startTime.getTime()) / 60_000;
        if (windowMin <= REDIAL_WINDOW_MIN) {
          redials.push({
            number,
            leadName: list[0].leadName ?? null,
            windowMin: Math.round(windowMin * 10) / 10,
            attempts: list.map((x) => ({ at: x.startTime, durationSec: x.durationSec })),
          });
          break; // one alert per number per day
        }
      }
    }

    const longCalls: LongCall[] = outboundCalls
      .filter((c) => c.durationSec >= REAL_CONVERSATION_SEC)
      .map((c) => ({
        at: c.startTime,
        number: c.toNumber ?? "",
        leadName: c.leadName ?? null,
        durationSec: c.durationSec,
      }))
      .sort((a, b) => b.durationSec - a.durationSec);

    const outbound = outboundCalls.length;
    const uniqueLeads = byNumber.size;
    const realConversations = longCalls.length;
    const possibleProfiles = outboundCalls.filter(
      (c) => c.durationSec >= POSSIBLE_PROFILE_SEC,
    ).length;
    rows.push({
      userId: g.userId,
      name: g.name,
      day: g.day,
      firstCall: first,
      lastCall: last,
      spanMin: Math.round((last.getTime() - first.getTime()) / 60_000),
      outbound,
      uniqueLeads,
      efficiencyPct: pct(uniqueLeads, outbound),
      realConversations,
      possibleProfiles,
      contactRatePct: pct(realConversations, outbound),
      inbound: inboundCalls.length,
      inboundMissed: inboundCalls.filter(
        (c) => !CONNECTED_RESULTS.has(c.result ?? ""),
      ).length,
      talkTimeSec: g.calls.reduce((n, c) => n + c.durationSec, 0),
      profilesCreated: activationsByKey.get(key) ?? 0,
      gaps,
      inactiveMin: gaps.reduce((n, x) => n + x.minutes, 0),
      redials,
      longCalls,
    });
  }

  // Newest day first, agents alphabetically inside a day.
  rows.sort((a, b) => b.day.localeCompare(a.day) || a.name.localeCompare(b.name));

  const totals = {
    outbound: rows.reduce((n, r) => n + r.outbound, 0),
    uniqueLeads: rows.reduce((n, r) => n + r.uniqueLeads, 0),
    realConversations: rows.reduce((n, r) => n + r.realConversations, 0),
    possibleProfiles: rows.reduce((n, r) => n + r.possibleProfiles, 0),
    profilesCreated: rows.reduce((n, r) => n + r.profilesCreated, 0),
    inboundMissed: rows.reduce((n, r) => n + r.inboundMissed, 0),
    alerts: rows.reduce(
      (n, r) => n + r.gaps.filter((x) => x.level !== "warn").length,
      0,
    ),
    redials: rows.reduce((n, r) => n + r.redials.length, 0),
  };
  return { rows, totals };
}
