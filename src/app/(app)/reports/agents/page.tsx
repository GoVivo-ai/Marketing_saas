import { FileDown, Headset, PhoneCall, Timer, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { getAgentPerformance } from "@/lib/agent-report";
import { requireFullAccess } from "@/lib/permissions";
import { resolveDateRange } from "@/lib/date-range";

export const dynamic = "force-dynamic";

const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];
const DEFAULT_RANGE = "30";

const fmtTalkTime = (sec: number): string => {
  if (sec === 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const fmtLatency = (min: number | null): string => {
  if (min == null) return "—";
  if (min < 60) return `${Math.round(min)}m`;
  if (min < 60 * 24) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / (60 * 24))}d`;
};

export default async function AgentActivityPage({
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
  // Narrow the report (and its PDF) to specific agents — comma-separated ids.
  const agentIds = sp.agent ? sp.agent.split(",").filter(Boolean) : [];

  const { active } = await getWorkspaceContext();
  await requireFullAccess(active?.id);
  const report = active
    ? await getAgentPerformance(active.id, {
        start: resolved.start,
        end: resolved.end,
      })
    : null;

  const agentOptions = (report?.rows ?? []).map((r) => ({
    value: r.userId,
    label: r.name || "Unknown user",
  }));
  const rows = (report?.rows ?? []).filter(
    (r) => agentIds.length === 0 || agentIds.includes(r.userId),
  );
  const totals = {
    rcCalls: rows.reduce((n, r) => n + r.rcCalls, 0),
    rcTalkTimeSec: rows.reduce((n, r) => n + r.rcTalkTimeSec, 0),
    leadsWorked: rows.reduce((n, r) => n + r.leadsWorked, 0),
  };

  // The PDF endpoint takes the exact same filters this view is showing.
  const pdfParams = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v) pdfParams.set(k, v);
  const pdfHref = `/api/reports/agent-activity?${pdfParams.toString()}`;

  const answerRate = (r: { rcCalls: number; rcConnected: number }) =>
    r.rcCalls > 0 ? `${Math.round((r.rcConnected / r.rcCalls) * 100)}%` : "—";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {active ? `${active.name} — Agent Activity` : "Agent Activity"}
            </h1>
            <p className="text-sm text-muted-foreground">
              Who is calling, how much, and how their leads move — app activity
              plus the real RingCentral call log
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
          {/* Base UI button — render an anchor so the PDF streams as a file. */}
          <Button variant="outline" render={<a href={pdfHref} download />}>
            <FileDown className="mr-1 h-4 w-4" />
            Download PDF
          </Button>
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

      {/* ── Team totals ─────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            icon: Users,
            label: "Active agents",
            value: rows.length,
          },
          {
            icon: PhoneCall,
            label: "RingCentral calls",
            value: totals.rcCalls,
          },
          {
            icon: Timer,
            label: "Talk time",
            value: fmtTalkTime(totals.rcTalkTimeSec),
          },
          {
            icon: Headset,
            label: "Leads worked",
            value: totals.leadsWorked,
          },
        ].map((k) => (
          <Card key={k.label}>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5">
                <k.icon className="h-3.5 w-3.5" />
                {k.label}
              </CardDescription>
              <CardTitle className="text-2xl tabular-nums">{k.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      {/* ── Per-agent breakdown ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Headset className="h-4 w-4 text-primary" />
            Performance by agent
          </CardTitle>
          <CardDescription>
            {resolved.label} · RC calls are matched to this client&apos;s leads
            by phone number; &quot;other&quot; counts the agent&apos;s remaining
            calls in the period. Won/Lost credits the last agent who touched
            the lead
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No agent activity in {resolved.label.toLowerCase()}. Log touches
              from the Contact Queue or press &quot;Sync calls&quot; to pull the
              RingCentral history.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead className="text-right">RC calls</TableHead>
                    <TableHead className="text-right">Answered</TableHead>
                    <TableHead className="text-right">Talk time</TableHead>
                    <TableHead className="text-right">Other calls</TableHead>
                    <TableHead className="text-right">Touches</TableHead>
                    <TableHead className="text-right">Leads worked</TableHead>
                    <TableHead className="text-right">Won / Lost</TableHead>
                    <TableHead className="text-right">First touch</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const touches =
                      r.touches.call +
                      r.touches.sms +
                      r.touches.whatsapp +
                      r.touches.email;
                    return (
                      <TableRow key={r.userId}>
                        <TableCell className="font-medium">
                          {r.name || "Unknown user"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.rcCalls}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {answerRate(r)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtTalkTime(r.rcTalkTimeSec)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {r.rcOtherCalls || "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span title={`${r.touches.call} calls · ${r.touches.sms} SMS · ${r.touches.whatsapp} WhatsApp · ${r.touches.email} email`}>
                            {touches}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.leadsWorked}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span className="text-success">{r.won}</span>
                          {" / "}
                          <span className="text-destructive">{r.lost}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtLatency(r.medianFirstTouchMin)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
