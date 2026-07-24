import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { OutreachOutcome } from "@/lib/outreach";

/**
 * Per-agent activity report: outreach touches logged in the app
 * (lead_events) + real call volume/talk time mirrored from RingCentral
 * (call_logs). Aggregated in JS — the per-workspace row counts are small.
 */

export interface AgentPerformanceRow {
  userId: string;
  name: string;
  /** Touches logged in the app, by channel. */
  touches: { call: number; sms: number; whatsapp: number; email: number };
  outcomes: Partial<Record<OutreachOutcome, number>>;
  /** Distinct leads of this workspace the agent touched in the period. */
  leadsWorked: number;
  /**
   * Wins/losses attributed to the agent. Nothing in the product assigns
   * leads yet (assignedToId is never written), so attribution is last-touch:
   * a closed lead belongs to the last agent who logged a touch on it —
   * unless it IS assigned, in which case the assignee wins.
   */
  won: number;
  lost: number;
  /** Median minutes from lead creation to the agent's first touch. */
  medianFirstTouchMin: number | null;
  /** RingCentral calls matched to this workspace's leads. */
  rcCalls: number;
  rcConnected: number;
  rcTalkTimeSec: number;
  /** RingCentral calls in the period not matched to this client's leads. */
  rcOtherCalls: number;
}

export interface AgentPerformanceReport {
  rows: AgentPerformanceRow[];
  totals: {
    touches: number;
    rcCalls: number;
    rcTalkTimeSec: number;
    leadsWorked: number;
  };
}

const TOUCH_TYPES = ["call", "sms", "whatsapp", "email"] as const;
type TouchType = (typeof TOUCH_TYPES)[number];

const CONNECTED_RESULTS = new Set(["Call connected", "Accepted", "Answered"]);

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export async function getAgentPerformance(
  workspaceId: string,
  opts: { start?: Date | null; end?: Date | null } = {},
): Promise<AgentPerformanceReport> {
  const eventFilters = [
    eq(schema.leads.workspaceId, workspaceId),
    inArray(schema.leadEvents.type, [...TOUCH_TYPES]),
  ];
  if (opts.start) eventFilters.push(gte(schema.leadEvents.createdAt, opts.start));
  if (opts.end) eventFilters.push(lte(schema.leadEvents.createdAt, opts.end));

  const callFilters = [];
  if (opts.start) callFilters.push(gte(schema.callLogs.startTime, opts.start));
  if (opts.end) callFilters.push(lte(schema.callLogs.startTime, opts.end));

  const [events, calls] = await Promise.all([
    db()
      .select({
        userId: schema.leadEvents.userId,
        leadId: schema.leadEvents.leadId,
        type: schema.leadEvents.type,
        payload: schema.leadEvents.payload,
        createdAt: schema.leadEvents.createdAt,
        leadCreatedAt: schema.leads.createdAt,
        leadStatus: schema.leads.status,
        leadAssignedTo: schema.leads.assignedToId,
      })
      .from(schema.leadEvents)
      .innerJoin(schema.leads, eq(schema.leadEvents.leadId, schema.leads.id))
      .where(and(...eventFilters)),
    db()
      .select({
        userId: schema.callLogs.userId,
        workspaceId: schema.callLogs.workspaceId,
        durationSec: schema.callLogs.durationSec,
        result: schema.callLogs.result,
      })
      .from(schema.callLogs)
      .where(callFilters.length ? and(...callFilters) : undefined),
  ]);

  const rowsById = new Map<string, AgentPerformanceRow>();
  const row = (userId: string): AgentPerformanceRow => {
    let r = rowsById.get(userId);
    if (!r) {
      r = {
        userId,
        name: "",
        touches: { call: 0, sms: 0, whatsapp: 0, email: 0 },
        outcomes: {},
        leadsWorked: 0,
        won: 0,
        lost: 0,
        medianFirstTouchMin: null,
        rcCalls: 0,
        rcConnected: 0,
        rcTalkTimeSec: 0,
        rcOtherCalls: 0,
      };
      rowsById.set(userId, r);
    }
    return r;
  };

  // ── App touches, worked leads and first-touch latency ──────────────────
  const workedLeads = new Map<string, Set<string>>(); // userId → leadIds
  // leadId → closed-lead attribution candidate: assignee if set, else the
  // agent whose touch is the most recent (last-touch attribution).
  const closedOwner = new Map<
    string,
    { status: string; assignedTo: string | null; lastUserId: string; lastAt: number }
  >();
  // leadId → per-agent first touch; latency is measured against the lead's
  // own creation, so it's only meaningful for the first agent to reach out.
  const firstTouch = new Map<string, { userId: string; deltaMin: number }>();
  for (const e of events) {
    if (!e.userId) continue;
    const r = row(e.userId);
    r.touches[e.type as TouchType]++;
    const outcome = (e.payload as { outcome?: OutreachOutcome } | null)?.outcome;
    if (outcome) r.outcomes[outcome] = (r.outcomes[outcome] ?? 0) + 1;

    let set = workedLeads.get(e.userId);
    if (!set) workedLeads.set(e.userId, (set = new Set()));
    set.add(e.leadId);

    if (e.leadStatus === "won" || e.leadStatus === "lost") {
      const at = e.createdAt.getTime();
      const prev = closedOwner.get(e.leadId);
      if (!prev || at > prev.lastAt)
        closedOwner.set(e.leadId, {
          status: e.leadStatus,
          assignedTo: e.leadAssignedTo,
          lastUserId: e.userId,
          lastAt: at,
        });
    }

    const deltaMin =
      (e.createdAt.getTime() - e.leadCreatedAt.getTime()) / 60_000;
    const prev = firstTouch.get(e.leadId);
    if (deltaMin >= 0 && (!prev || deltaMin < prev.deltaMin))
      firstTouch.set(e.leadId, { userId: e.userId, deltaMin });
  }
  for (const [userId, set] of workedLeads) row(userId).leadsWorked = set.size;
  const latencies = new Map<string, number[]>();
  for (const t of firstTouch.values()) {
    let xs = latencies.get(t.userId);
    if (!xs) latencies.set(t.userId, (xs = []));
    xs.push(t.deltaMin);
  }
  for (const [userId, xs] of latencies)
    row(userId).medianFirstTouchMin = median(xs);

  // ── Win/loss attribution ───────────────────────────────────────────────
  for (const c of closedOwner.values()) {
    const r = row(c.assignedTo ?? c.lastUserId);
    if (c.status === "won") r.won++;
    else r.lost++;
  }

  // ── RingCentral call volume ────────────────────────────────────────────
  // Only users already active in this workspace get their off-client calls
  // counted — otherwise every RC user would appear in every client's report.
  for (const c of calls) {
    if (c.workspaceId === workspaceId) {
      const r = row(c.userId);
      r.rcCalls++;
      r.rcTalkTimeSec += c.durationSec;
      if (c.result && CONNECTED_RESULTS.has(c.result)) r.rcConnected++;
    } else if (rowsById.has(c.userId)) {
      row(c.userId).rcOtherCalls++;
    }
  }

  // ── Names ──────────────────────────────────────────────────────────────
  const ids = [...rowsById.keys()];
  if (ids.length > 0) {
    const users = await db()
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(inArray(schema.users.id, ids));
    for (const u of users) row(u.id).name = u.name;
  }

  const rows = [...rowsById.values()].sort(
    (a, b) =>
      b.rcCalls + b.touches.call - (a.rcCalls + a.touches.call) ||
      a.name.localeCompare(b.name),
  );
  return {
    rows,
    totals: {
      touches: rows.reduce(
        (n, r) =>
          n + r.touches.call + r.touches.sms + r.touches.whatsapp + r.touches.email,
        0,
      ),
      rcCalls: rows.reduce((n, r) => n + r.rcCalls, 0),
      rcTalkTimeSec: rows.reduce((n, r) => n + r.rcTalkTimeSec, 0),
      leadsWorked: rows.reduce((n, r) => n + r.leadsWorked, 0),
    },
  };
}
