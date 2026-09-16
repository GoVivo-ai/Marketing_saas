import {
  getCampaignRows,
  getLeadsPage,
  getPipelineLeadsForExport,
  type PipelineDateBasis,
} from "@/lib/data";
import { getDispatchDirectory } from "@/lib/dispatch-data";
import { getDailyCallReport } from "@/lib/call-report";
import { getAgentPerformance } from "@/lib/agent-report";
import { CC_STATUS_LABEL, isCcStatus } from "@/lib/cc";
import { leadSourceLabel } from "@/lib/lead-source";
import { resolveDateRange } from "@/lib/date-range";
import type { ExportTable } from "./table";

/**
 * Every downloadable view, keyed by the dataset name in the URL. Each builder
 * re-runs the page's own query from the same search params, so a download is
 * exactly the slice on screen — not the current page of it, and not a
 * separate definition of the numbers that can drift from the UI.
 */

export const EXPORT_DATASETS = [
  "campaigns",
  "leads",
  "pipeline",
  "dispatch",
  "calls",
  "agents",
] as const;

export type ExportDataset = (typeof EXPORT_DATASETS)[number];

export function isExportDataset(v: string): v is ExportDataset {
  return EXPORT_DATASETS.includes(v as ExportDataset);
}

/** Leads/pipeline downloads are capped so one click can't pull a million rows. */
export const EXPORT_ROW_CAP = 20_000;

const list = (sp: URLSearchParams, key: string): string[] =>
  (sp.get(key) ?? "").split(",").filter(Boolean);

const dateOpts = (sp: URLSearchParams) => ({
  range: sp.get("range") ?? undefined,
  from: sp.get("from") ?? undefined,
  to: sp.get("to") ?? undefined,
});

const stamp = () => new Date().toISOString().slice(0, 10);

export async function buildExportTable(
  dataset: ExportDataset,
  ctx: { workspaceId: string; workspaceName: string },
  sp: URLSearchParams,
): Promise<ExportTable> {
  const { workspaceId, workspaceName } = ctx;
  const slug = workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  switch (dataset) {
    case "campaigns": {
      const range = resolveDateRange(dateOpts(sp), {
        presets: [7, 30, 90],
        defaultPreset: "30",
        allowAllTime: false,
      });
      const rows = await getCampaignRows(workspaceId, {
        start: range.start!,
        end: range.end!,
      });
      return {
        filename: `campaigns-${slug}-${stamp()}`,
        title: `${workspaceName} — Campaigns`,
        subtitle: `${range.label} · delivery is the live state in Ads Manager`,
        columns: [
          { key: "name", label: "Campaign", width: 26 },
          { key: "platform", label: "Platform", width: 9 },
          { key: "delivery", label: "Delivery", width: 11 },
          { key: "objective", label: "Objective", width: 14 },
          { key: "spend", label: "Spend", align: "right", width: 10, money: true },
          { key: "impressions", label: "Impressions", align: "right", width: 11 },
          { key: "clicks", label: "Clicks", align: "right", width: 8 },
          { key: "leads", label: "Leads", align: "right", width: 8 },
          { key: "cpl", label: "CPL", align: "right", width: 9, money: true },
        ],
        rows: rows.map((c) => ({
          name: c.name,
          platform: c.platform === "meta" ? "Meta" : "Google Ads",
          delivery: c.delivery.label,
          objective: c.objective ?? "",
          spend: c.spend,
          impressions: c.impressions,
          clicks: c.clicks,
          leads: c.leads,
          cpl: c.cpl || null,
        })),
        totals: {
          name: `Totals · ${rows.length} campaign${rows.length === 1 ? "" : "s"}`,
          spend: rows.reduce((s, c) => s + c.spend, 0),
          impressions: rows.reduce((s, c) => s + c.impressions, 0),
          clicks: rows.reduce((s, c) => s + c.clicks, 0),
          leads: rows.reduce((s, c) => s + c.leads, 0),
        },
      };
    }

    case "leads": {
      const range = resolveDateRange(dateOpts(sp), {
        presets: [7, 30, 90],
        defaultPreset: "all",
        allowAllTime: true,
      });
      const page = await getLeadsPage(workspaceId, {
        start: range.start,
        end: range.end,
        page: 1,
        pageSize: EXPORT_ROW_CAP,
        campaignId: sp.get("campaign"),
        stageId: sp.get("stage"),
        city: sp.get("city"),
        source: sp.get("source"),
        q: sp.get("q"),
      });
      return {
        filename: `leads-${slug}-${stamp()}`,
        title: `${workspaceName} — Leads`,
        subtitle: `${range.label} · ${page.total} leads`,
        columns: [
          { key: "name", label: "Name", width: 16 },
          { key: "email", label: "Email", width: 20 },
          { key: "phone", label: "Phone", width: 12 },
          { key: "source", label: "Source", width: 9 },
          { key: "campaign", label: "Campaign", width: 20 },
          { key: "stage", label: "Stage", width: 13 },
          { key: "aiScore", label: "AI score", align: "right", width: 8 },
          { key: "city", label: "City", width: 12 },
          { key: "createdAt", label: "Received", width: 10 },
        ],
        rows: page.rows.map((l) => ({
          name: l.name,
          email: l.email === "—" ? "" : l.email,
          phone: l.phone === "—" ? "" : l.phone,
          source: leadSourceLabel(l.source),
          campaign: l.campaign === "—" ? "" : l.campaign,
          stage: l.stageName ?? l.status,
          aiScore: l.aiScore,
          city: l.geo?.leadCity ?? "",
          createdAt: l.createdAt,
        })),
      };
    }

    case "pipeline": {
      const range = resolveDateRange(dateOpts(sp), {
        presets: [7, 30, 90],
        defaultPreset: "all",
        allowAllTime: true,
      });
      const dateBy: PipelineDateBasis =
        sp.get("dateBy") === "stage" ? "stage" : "created";
      const rows = await getPipelineLeadsForExport(workspaceId, {
        regions: list(sp, "state"),
        cities: list(sp, "city"),
        agents: list(sp, "agent"),
        start: range.start,
        end: range.end,
        ccStatus: sp.get("cc"),
        dateBy,
      });
      return {
        filename: `pipeline-${slug}-${stamp()}`,
        title: `${workspaceName} — Pipeline`,
        subtitle: `${range.label} · by ${dateBy === "stage" ? "stage entry" : "lead creation"} · ${rows.length} leads`,
        columns: [
          { key: "name", label: "Name", width: 16 },
          { key: "stage", label: "Stage", width: 14 },
          { key: "ccStatus", label: "Compliance", width: 13 },
          { key: "phone", label: "Phone", width: 12 },
          { key: "email", label: "Email", width: 19 },
          { key: "source", label: "Source", width: 9 },
          { key: "campaign", label: "Campaign", width: 17 },
          { key: "city", label: "City", width: 12 },
          { key: "region", label: "State", width: 11 },
          { key: "aiScore", label: "AI score", align: "right", width: 8 },
          { key: "agentName", label: "Agent", width: 11 },
          { key: "createdAt", label: "Created", width: 10 },
        ],
        rows: rows.map((r) => ({
          ...r,
          source: leadSourceLabel(r.source),
          ccStatus: isCcStatus(r.ccStatus) ? CC_STATUS_LABEL[r.ccStatus] : (r.ccStatus ?? ""),
          agentName: r.agentName ?? "",
        })),
      };
    }

    case "dispatch": {
      const dir = await getDispatchDirectory(workspaceId, {
        q: sp.get("q"),
        area: sp.get("area"),
        status: sp.get("status"),
        page: 1,
        pageSize: EXPORT_ROW_CAP,
      });
      return {
        filename: `dispatch-drivers-${slug}-${stamp()}`,
        title: `${workspaceName} — Drivers`,
        subtitle: `${dir.total} drivers`,
        columns: [
          { key: "mdd", label: "MDD", width: 9 },
          { key: "name", label: "Driver", width: 18 },
          { key: "status", label: "Status", width: 10 },
          { key: "area", label: "Area", width: 12 },
          { key: "state", label: "State", width: 10 },
          { key: "phone", label: "Phone", width: 12 },
          { key: "email", label: "Email", width: 20 },
          { key: "camera", label: "Camera", width: 8 },
          { key: "carSeats", label: "Car seats", align: "right", width: 8 },
          { key: "boosterSeats", label: "Boosters", align: "right", width: 8 },
          { key: "coverCount", label: "Covers", align: "right", width: 8 },
          { key: "interactionCount", label: "Touches", align: "right", width: 8 },
          { key: "lastInteractionAt", label: "Last touch", width: 10 },
        ],
        rows: dir.drivers.map((d) => ({
          mdd: d.mdd ?? "",
          name: d.name,
          status: d.status,
          area: d.area ?? "",
          state: d.state ?? "",
          phone: d.phone ?? "",
          email: d.email ?? "",
          camera: d.camera ? "Yes" : "No",
          carSeats: d.carSeats,
          boosterSeats: d.boosterSeats,
          coverCount: d.coverCount,
          interactionCount: d.interactionCount,
          lastInteractionAt: d.lastInteractionAt,
        })),
      };
    }

    case "calls": {
      const range = resolveDateRange(dateOpts(sp), {
        presets: [7, 30, 90],
        defaultPreset: "7",
        allowAllTime: false,
      });
      const report = await getDailyCallReport(workspaceId, {
        start: range.start,
        end: range.end,
      });
      return {
        filename: `daily-calls-${slug}-${stamp()}`,
        title: `${workspaceName} — Daily Calls`,
        subtitle: `${range.label} · one row per agent per day`,
        columns: [
          { key: "day", label: "Day", width: 10 },
          { key: "name", label: "Agent", width: 16 },
          { key: "outbound", label: "Outbound", align: "right", width: 9 },
          { key: "uniqueLeads", label: "Unique", align: "right", width: 8 },
          { key: "efficiencyPct", label: "Efficiency", align: "right", width: 9 },
          { key: "realConversations", label: "Real convos", align: "right", width: 10 },
          { key: "contactRatePct", label: "Contact rate", align: "right", width: 10 },
          { key: "profilesCreated", label: "Profiles", align: "right", width: 8 },
          { key: "inboundMissed", label: "Missed in", align: "right", width: 9 },
          { key: "talkTimeMin", label: "Talk (min)", align: "right", width: 9 },
          { key: "spanMin", label: "Span (min)", align: "right", width: 9 },
          { key: "alerts", label: "Gap alerts", align: "right", width: 9 },
        ],
        rows: report.rows.map((r) => ({
          day: r.day,
          name: r.name,
          outbound: r.outbound,
          uniqueLeads: r.uniqueLeads,
          efficiencyPct: r.efficiencyPct != null ? `${r.efficiencyPct}%` : "",
          realConversations: r.realConversations,
          contactRatePct: r.contactRatePct != null ? `${r.contactRatePct}%` : "",
          profilesCreated: r.profilesCreated,
          inboundMissed: r.inboundMissed,
          talkTimeMin: Math.round(r.talkTimeSec / 60),
          spanMin: r.spanMin,
          alerts: r.gaps.length,
        })),
        totals: {
          day: "Totals",
          outbound: report.totals.outbound,
          uniqueLeads: report.totals.uniqueLeads,
          realConversations: report.totals.realConversations,
          profilesCreated: report.totals.profilesCreated,
          inboundMissed: report.totals.inboundMissed,
          alerts: report.totals.alerts,
        },
      };
    }

    case "agents": {
      const range = resolveDateRange(dateOpts(sp), {
        presets: [7, 30, 90],
        defaultPreset: "30",
        allowAllTime: false,
      });
      const report = await getAgentPerformance(workspaceId, {
        start: range.start,
        end: range.end,
      });
      const agentIds = list(sp, "agent");
      const rows = agentIds.length
        ? report.rows.filter((r) => agentIds.includes(r.userId))
        : report.rows;
      return {
        filename: `agent-activity-${slug}-${stamp()}`,
        title: `${workspaceName} — Agent Activity`,
        subtitle: `${range.label} · ${rows.length} agents`,
        columns: [
          { key: "name", label: "Agent", width: 18 },
          { key: "calls", label: "Calls", align: "right", width: 8 },
          { key: "sms", label: "SMS", align: "right", width: 8 },
          { key: "whatsapp", label: "WhatsApp", align: "right", width: 9 },
          { key: "email", label: "Email", align: "right", width: 8 },
          { key: "leadsWorked", label: "Leads worked", align: "right", width: 10 },
          { key: "won", label: "Won", align: "right", width: 7 },
          { key: "lost", label: "Lost", align: "right", width: 7 },
          { key: "firstTouch", label: "Median 1st touch (min)", align: "right", width: 13 },
          { key: "rcCalls", label: "RC calls", align: "right", width: 9 },
          { key: "rcConnected", label: "RC connected", align: "right", width: 10 },
          { key: "rcTalkMin", label: "RC talk (min)", align: "right", width: 10 },
        ],
        rows: rows.map((r) => ({
          name: r.name,
          calls: r.touches.call,
          sms: r.touches.sms,
          whatsapp: r.touches.whatsapp,
          email: r.touches.email,
          leadsWorked: r.leadsWorked,
          won: r.won,
          lost: r.lost,
          firstTouch: r.medianFirstTouchMin,
          rcCalls: r.rcCalls,
          rcConnected: r.rcConnected,
          rcTalkMin: Math.round(r.rcTalkTimeSec / 60),
        })),
      };
    }
  }
}
