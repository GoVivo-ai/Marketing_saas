"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { BarChart3, CalendarDays, PhoneCall, Trophy } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

/**
 * Charts for the Agent Activity report. Channel hues are a validated
 * colorblind-safe set (fixed order, never cycled); won/lost wears the app's
 * status colors. The table below the charts is the accessible fallback.
 */

const CHANNEL_COLORS = {
  call: "#1d4ed8",
  sms: "#0d9488",
  whatsapp: "#b45309",
  email: "#9333ea",
} as const;

const touchesConfig = {
  call: { label: "Calls", color: CHANNEL_COLORS.call },
  sms: { label: "SMS", color: CHANNEL_COLORS.sms },
  whatsapp: { label: "WhatsApp", color: CHANNEL_COLORS.whatsapp },
  email: { label: "Email", color: CHANNEL_COLORS.email },
} satisfies ChartConfig;

const wonLostConfig = {
  won: { label: "Won", color: "var(--success)" },
  lost: { label: "Lost", color: "var(--destructive)" },
} satisfies ChartConfig;

const dailyConfig = {
  touches: { label: "Touches", color: "#1d4ed8" },
  calls: { label: "RC calls", color: "#0d9488" },
} satisfies ChartConfig;

export interface AgentChartRow {
  name: string;
  touches: { call: number; sms: number; whatsapp: number; email: number };
  outcomes: Record<string, number>;
  won: number;
  lost: number;
}

const OUTCOME_LABELS: Record<string, string> = {
  answered: "Answered",
  replied: "Replied",
  no_answer: "No answer",
  voicemail: "Voicemail",
  sent: "Sent",
  not_interested: "Not interested",
  wrong_number: "Wrong number",
};

/** First name + initial keeps the y-axis narrow without losing identity. */
const shortName = (full: string): string => {
  const [first, second] = full.split(/\s+/);
  return second ? `${first} ${second[0]}.` : first;
};

export function AgentActivityCharts({
  rows,
  daily,
}: {
  rows: AgentChartRow[];
  daily: { day: string; touches: number; calls: number }[];
}) {
  if (rows.length === 0) return null;

  const byAgent = rows.map((r) => ({
    name: shortName(r.name || "Unknown"),
    ...r.touches,
    won: r.won,
    lost: r.lost,
  }));
  const outcomeTotals = Object.entries(
    rows.reduce<Record<string, number>>((acc, r) => {
      for (const [k, v] of Object.entries(r.outcomes))
        acc[k] = (acc[k] ?? 0) + v;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const maxOutcome = outcomeTotals[0]?.[1] ?? 0;
  const hasCalls = daily.some((d) => d.calls > 0);
  // ~34px per agent keeps bars readable at any team size.
  const agentChartHeight = Math.max(160, byAgent.length * 34 + 40);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* ── Touches by agent, stacked by channel ─────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4 text-primary" />
            Touches by agent
          </CardTitle>
          <CardDescription>
            Outreach logged in the app, split by channel
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={touchesConfig}
            className="w-full"
            style={{ height: agentChartHeight }}
          >
            <BarChart data={byAgent} layout="vertical" margin={{ right: 12 }}>
              <CartesianGrid horizontal={false} strokeDasharray="3 3" />
              <XAxis type="number" tickLine={false} axisLine={false} />
              <YAxis
                type="category"
                dataKey="name"
                tickLine={false}
                axisLine={false}
                width={92}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              {(["call", "sms", "whatsapp", "email"] as const).map((k) => (
                <Bar
                  key={k}
                  dataKey={k}
                  stackId="touches"
                  fill={`var(--color-${k})`}
                  stroke="var(--background)"
                  strokeWidth={1}
                />
              ))}
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* ── Won / Lost by agent ──────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Trophy className="h-4 w-4 text-primary" />
            Won / Lost by agent
          </CardTitle>
          <CardDescription>
            Closed leads credited to the last agent who touched them
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={wonLostConfig}
            className="w-full"
            style={{ height: agentChartHeight }}
          >
            <BarChart data={byAgent} layout="vertical" margin={{ right: 12 }}>
              <CartesianGrid horizontal={false} strokeDasharray="3 3" />
              <XAxis type="number" tickLine={false} axisLine={false} />
              <YAxis
                type="category"
                dataKey="name"
                tickLine={false}
                axisLine={false}
                width={92}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="won" fill="var(--color-won)" radius={[0, 4, 4, 0]} />
              <Bar dataKey="lost" fill="var(--color-lost)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* ── Daily activity ───────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4 text-primary" />
            Daily activity
          </CardTitle>
          <CardDescription>
            Touches{hasCalls ? " and RingCentral calls" : ""} per day across
            the period
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={dailyConfig} className="h-[220px] w-full">
            <BarChart data={daily} margin={{ right: 12 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={false}
                minTickGap={28}
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis tickLine={false} axisLine={false} width={36} />
              <ChartTooltip content={<ChartTooltipContent />} />
              {hasCalls && <ChartLegend content={<ChartLegendContent />} />}
              <Bar
                dataKey="touches"
                fill="var(--color-touches)"
                radius={[3, 3, 0, 0]}
              />
              {hasCalls && (
                <Bar
                  dataKey="calls"
                  fill="var(--color-calls)"
                  radius={[3, 3, 0, 0]}
                />
              )}
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* ── Outcome distribution ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PhoneCall className="h-4 w-4 text-primary" />
            Outcome distribution
          </CardTitle>
          <CardDescription>
            What happened across every logged touch
          </CardDescription>
        </CardHeader>
        <CardContent>
          {outcomeTotals.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No outcomes recorded in this period.
            </p>
          ) : (
            <ul className="space-y-3">
              {outcomeTotals.map(([key, count]) => (
                <li key={key}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                    <span>{OUTCOME_LABELS[key] ?? key}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {count}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted/40">
                    <div
                      className="h-full rounded-full bg-primary/60"
                      style={{
                        width: `${maxOutcome > 0 ? Math.max((count / maxOutcome) * 100, 2) : 0}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
