import {
  AlertTriangle,
  Headset,
  PhoneCall,
  PhoneIncoming,
  Repeat,
  UserCheck,
  Users,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DateRangePicker } from "@/components/app/date-range-picker";
import { LeadsMultiFilter } from "@/components/app/leads-filter";
import { ReportsNav } from "@/components/app/reports-nav";
import { SyncCallsButton } from "@/components/app/sync-calls-button";
import { getWorkspaceContext } from "@/lib/data";
import {
  CALL_REPORT_TZ,
  INACTIVITY_MIN,
  POSSIBLE_PROFILE_SEC,
  REAL_CONVERSATION_SEC,
  REDIAL_MIN_ATTEMPTS,
  REDIAL_WINDOW_MIN,
  getDailyCallReport,
  type AgentDayRow,
  type GapLevel,
} from "@/lib/call-report";
import { requireFullAccess } from "@/lib/permissions";
import { resolveDateRange } from "@/lib/date-range";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];
const DEFAULT_RANGE = "7";

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: CALL_REPORT_TZ,
  hour: "numeric",
  minute: "2-digit",
});
const dayLabelFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
});
const fmtTime = (d: Date) => timeFmt.format(d);
const fmtDay = (day: string) => dayLabelFmt.format(new Date(`${day}T00:00:00Z`));
const fmtDur = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
};
const fmtMin = (min: number) =>
  min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`;
const fmtPct = (p: number | null) => (p == null ? "—" : `${p}%`);

const GAP_STYLE: Record<GapLevel, { label: string; cls: string }> = {
  warn: { label: "10–20 min", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  alert: { label: "20–30 min", cls: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300" },
  critical: { label: "30+ min", cls: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300" },
};

/**
 * The ops lead's daily RingCentral tracker, live: per agent per day —
 * outbound dials, unique numbers, real conversations, possible profiles,
 * missed inbound, profiles created — plus the two alerts from the ops doc
 * (inactivity between calls, hammering one number). Replaces exporting a
 * CSV per agent and feeding it to a prompt.
 */
export default async function DailyCallsPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string;
    from?: string;
    to?: string;
    agent?: string;
  }>;
}) {
  const sp = await searchParams;
  const resolved = resolveDateRange(sp, {
    presets: [7, 30, 90],
    defaultPreset: DEFAULT_RANGE,
    allowAllTime: false,
  });
  const agentIds = sp.agent ? sp.agent.split(",").filter(Boolean) : [];

  const { active } = await getWorkspaceContext();
  await requireFullAccess(active?.id);
  const report = active
    ? await getDailyCallReport(active.id, {
        start: resolved.start,
        end: resolved.end,
      })
    : { rows: [], totals: null };

  const agentOptions = [
    ...new Map(report.rows.map((r) => [r.userId, r.name])).entries(),
  ].map(([value, label]) => ({ value, label }));
  const rows = report.rows.filter(
    (r) => agentIds.length === 0 || agentIds.includes(r.userId),
  );
  const sum = (f: (r: AgentDayRow) => number) => rows.reduce((n, r) => n + f(r), 0);
  const totals = {
    outbound: sum((r) => r.outbound),
    uniqueLeads: sum((r) => r.uniqueLeads),
    realConversations: sum((r) => r.realConversations),
    possibleProfiles: sum((r) => r.possibleProfiles),
    profilesCreated: sum((r) => r.profilesCreated),
    inboundMissed: sum((r) => r.inboundMissed),
    alerts: sum((r) => r.gaps.filter((g) => g.level !== "warn").length),
    redials: sum((r) => r.redials.length),
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {active ? `${active.name} — Daily Calls` : "Daily Calls"}
            </h1>
            <p className="text-sm text-muted-foreground">
              The daily performance tracker, straight from the RingCentral
              call log — one row per agent per day, with inactivity and redial
              alerts
            </p>
          </div>
          <ReportsNav />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SyncCallsButton />
          <LeadsMultiFilter
            param="agent"
            icon="agent"
            title="Agent"
            allLabel="All agents"
            activeValues={agentIds}
            options={agentOptions}
          />
          <label className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Period
            </span>
            <DateRangePicker
              presets={RANGES}
              defaultValue={DEFAULT_RANGE}
              label={resolved.label}
            />
          </label>
        </div>
      </div>

      {/* ── Period totals ───────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: PhoneCall, label: "Outbound calls", value: totals.outbound },
          {
            icon: Users,
            label: "Unique leads touched",
            value: totals.uniqueLeads,
            hint: `${fmtPct(totals.outbound ? Math.round((totals.uniqueLeads / totals.outbound) * 100) : null)} efficiency`,
          },
          {
            icon: Headset,
            label: "Real conversations",
            value: totals.realConversations,
            hint: `≥ ${REAL_CONVERSATION_SEC / 60} min · ${fmtPct(totals.outbound ? Math.round((totals.realConversations / totals.outbound) * 100) : null)} contact rate`,
          },
          {
            icon: UserCheck,
            label: "Possible profiles",
            value: totals.possibleProfiles,
            hint: `≥ ${POSSIBLE_PROFILE_SEC / 60} min · ${totals.profilesCreated} profile${totals.profilesCreated === 1 ? "" : "s"} created`,
          },
        ].map((k) => (
          <Card key={k.label}>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5">
                <k.icon className="h-3.5 w-3.5" />
                {k.label}
              </CardDescription>
              <CardTitle className="text-2xl tabular-nums">{k.value}</CardTitle>
              {k.hint && (
                <p className="text-xs text-muted-foreground">{k.hint}</p>
              )}
            </CardHeader>
          </Card>
        ))}
      </div>

      {/* ── Per agent per day ───────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PhoneCall className="h-4 w-4 text-primary" />
            Performance by agent and day
          </CardTitle>
          <CardDescription>
            {resolved.label} · days in {CALL_REPORT_TZ.replace("_", " ")} time.
            Unique = distinct numbers dialed; Real = outbound calls of{" "}
            {REAL_CONVERSATION_SEC / 60}+ min; Profiles? = {POSSIBLE_PROFILE_SEC / 60}+
            min; Created = leads the agent moved into Contractor Compliance.
            Expand a row for the long calls and alerts
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No calls in {resolved.label.toLowerCase()}. Press &quot;Sync
              calls&quot; to pull the latest RingCentral history.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Day</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Shift</TableHead>
                    <TableHead className="text-right">Outbound</TableHead>
                    <TableHead className="text-right">Unique</TableHead>
                    <TableHead className="text-right">Efficiency</TableHead>
                    <TableHead className="text-right">Real</TableHead>
                    <TableHead className="text-right">Contact rate</TableHead>
                    <TableHead className="text-right">Profiles?</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                    <TableHead className="text-right">
                      <span title="Inbound calls the agent didn't answer">
                        <PhoneIncoming className="inline h-3.5 w-3.5" /> missed
                      </span>
                    </TableHead>
                    <TableHead className="text-right">Inactive</TableHead>
                    <TableHead className="text-right">Alerts</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <AgentDayRows key={`${r.userId}|${r.day}`} row={r} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {(totals.alerts > 0 || totals.redials > 0) && (
        <p className="text-xs text-muted-foreground">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-amber-500" />
          Inactivity = {INACTIVITY_MIN}+ min between the end of one call and
          the next, inside the agent&apos;s first-to-last call of the day.
          Redial = {REDIAL_MIN_ATTEMPTS}+ dials to one number within{" "}
          {REDIAL_WINDOW_MIN} min. Both come from the synced log, so they show
          after the nightly sync or a manual &quot;Sync calls&quot; — not live.
        </p>
      )}
    </div>
  );
}

/** One agent-day: the KPI row plus a native expandable detail row. */
function AgentDayRows({ row: r }: { row: AgentDayRow }) {
  const seriousGaps = r.gaps.filter((g) => g.level !== "warn");
  const hasDetail = r.longCalls.length > 0 || r.gaps.length > 0 || r.redials.length > 0;
  const worst = r.gaps.reduce<GapLevel | null>(
    (w, g) =>
      w === "critical" || g.level === "critical"
        ? "critical"
        : w === "alert" || g.level === "alert"
          ? "alert"
          : "warn",
    null,
  );
  return (
    <>
      <TableRow>
        <TableCell className="whitespace-nowrap font-medium">{fmtDay(r.day)}</TableCell>
        <TableCell className="whitespace-nowrap">{r.name}</TableCell>
        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
          {fmtTime(r.firstCall)} – {fmtTime(r.lastCall)}
          <span className="ml-1">({fmtMin(r.spanMin)})</span>
        </TableCell>
        <TableCell className="text-right tabular-nums">{r.outbound}</TableCell>
        <TableCell className="text-right tabular-nums">{r.uniqueLeads}</TableCell>
        <TableCell className="text-right tabular-nums">{fmtPct(r.efficiencyPct)}</TableCell>
        <TableCell className="text-right tabular-nums">{r.realConversations}</TableCell>
        <TableCell className="text-right tabular-nums">{fmtPct(r.contactRatePct)}</TableCell>
        <TableCell className="text-right tabular-nums">{r.possibleProfiles}</TableCell>
        <TableCell className="text-right tabular-nums">
          {r.profilesCreated ? (
            <span className="font-medium text-success">{r.profilesCreated}</span>
          ) : (
            "—"
          )}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {r.inboundMissed || (r.inbound ? "0" : "—")}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {r.inactiveMin ? (
            <span title={`${fmtPct(r.spanMin ? Math.round((r.inactiveMin / r.spanMin) * 100) : null)} of the shift`}>
              {fmtMin(r.inactiveMin)}
            </span>
          ) : (
            "—"
          )}
        </TableCell>
        <TableCell className="text-right">
          <span className="inline-flex items-center justify-end gap-1">
            {seriousGaps.length > 0 && worst && (
              <span
                className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums", GAP_STYLE[worst].cls)}
                title={`${seriousGaps.length} inactivity alert${seriousGaps.length === 1 ? "" : "s"} (20+ min)`}
              >
                {seriousGaps.length} idle
              </span>
            )}
            {r.redials.length > 0 && (
              <span
                className="inline-flex items-center gap-0.5 rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"
                title="Numbers dialed 3+ times within 10 minutes"
              >
                <Repeat className="h-3 w-3" />
                {r.redials.length}
              </span>
            )}
            {seriousGaps.length === 0 && r.redials.length === 0 && (
              <span className="text-muted-foreground">—</span>
            )}
          </span>
        </TableCell>
      </TableRow>
      {hasDetail && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={13} className="bg-muted/30 p-0">
            <details className="group">
              <summary className="cursor-pointer select-none px-4 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                <span className="group-open:hidden">Show</span>
                <span className="hidden group-open:inline">Hide</span>{" "}
                {r.longCalls.length} long call{r.longCalls.length === 1 ? "" : "s"}
                {r.gaps.length > 0 && ` · ${r.gaps.length} inactivity gap${r.gaps.length === 1 ? "" : "s"}`}
                {r.redials.length > 0 && ` · ${r.redials.length} redial${r.redials.length === 1 ? "" : "s"}`}
              </summary>
              <div className="grid gap-4 px-4 pb-4 pt-1 text-xs md:grid-cols-3">
                <div>
                  <p className="mb-1 font-medium uppercase tracking-wide text-muted-foreground">
                    Long calls ({REAL_CONVERSATION_SEC / 60}+ min)
                  </p>
                  {r.longCalls.length === 0 ? (
                    <p className="text-muted-foreground">None</p>
                  ) : (
                    <ul className="space-y-0.5">
                      {r.longCalls.map((c, i) => (
                        <li key={i} className="flex justify-between gap-3 tabular-nums">
                          <span className="truncate">
                            {fmtTime(c.at)} · {c.leadName ?? c.number}
                          </span>
                          <span
                            className={cn(
                              "shrink-0 font-medium",
                              c.durationSec >= POSSIBLE_PROFILE_SEC && "text-success",
                            )}
                          >
                            {fmtDur(c.durationSec)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="mb-1 font-medium uppercase tracking-wide text-muted-foreground">
                    Inactivity ({INACTIVITY_MIN}+ min between calls)
                  </p>
                  {r.gaps.length === 0 ? (
                    <p className="text-muted-foreground">None</p>
                  ) : (
                    <ul className="space-y-0.5">
                      {r.gaps.map((g, i) => (
                        <li key={i} className="flex items-center justify-between gap-3 tabular-nums">
                          <span>
                            {fmtTime(g.from)} – {fmtTime(g.to)}
                          </span>
                          <span className={cn("rounded px-1.5 py-0.5 font-medium", GAP_STYLE[g.level].cls)}>
                            {fmtMin(g.minutes)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="mb-1 font-medium uppercase tracking-wide text-muted-foreground">
                    Redials ({REDIAL_MIN_ATTEMPTS}+ in {REDIAL_WINDOW_MIN} min)
                  </p>
                  {r.redials.length === 0 ? (
                    <p className="text-muted-foreground">None</p>
                  ) : (
                    <ul className="space-y-1">
                      {r.redials.map((d) => (
                        <li key={d.number}>
                          <p className="font-medium">
                            {d.leadName ?? d.number}
                            <span className="ml-1 font-normal text-muted-foreground">
                              · {d.attempts.length} dials in {d.windowMin} min
                            </span>
                          </p>
                          <p className="text-muted-foreground tabular-nums">
                            {d.attempts
                              .map((a) => `${fmtTime(a.at)} (${fmtDur(a.durationSec)})`)
                              .join(" → ")}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </details>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
