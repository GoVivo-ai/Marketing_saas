"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { demoDailySeries } from "@/lib/demo-data";

const config = {
  spend: { label: "Spend (USD)", color: "var(--chart-1)" },
  leads: { label: "Leads", color: "var(--chart-2)" },
} satisfies ChartConfig;

export function PerformanceChart() {
  return (
    <ChartContainer config={config} className="h-[280px] w-full">
      <AreaChart data={demoDailySeries} margin={{ left: 0, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="fillSpend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-spend)" stopOpacity={0.6} />
            <stop offset="95%" stopColor="var(--color-spend)" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="fillLeads" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-leads)" stopOpacity={0.6} />
            <stop offset="95%" stopColor="var(--color-leads)" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={28}
          tickFormatter={(v: string) => v.slice(5)}
        />
        <YAxis tickLine={false} axisLine={false} width={42} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area
          dataKey="spend"
          type="monotone"
          fill="url(#fillSpend)"
          stroke="var(--color-spend)"
          strokeWidth={2}
        />
        <Area
          dataKey="leads"
          type="monotone"
          fill="url(#fillLeads)"
          stroke="var(--color-leads)"
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  );
}
