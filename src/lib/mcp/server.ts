import { and, desc, eq, inArray } from "drizzle-orm";
import { endOfDay, parseISO, startOfDay, subDays, isValid } from "date-fns";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import {
  getAgentPerformance,
  type AgentPerformanceRow,
} from "@/lib/agent-report";
import {
  getCampaignRows,
  getFunnelReport,
  getLeadRowById,
  getLeadsPage,
  getOverview,
  getPipeline,
  searchPipelineLeads,
} from "@/lib/data";
import { getWorkspaceRole, isPlatformAdmin, type Role } from "@/lib/permissions";
import type { ApiKeyPrincipal } from "@/lib/api-keys";

/**
 * Read-only MCP server. Every tool queries the platform AS the API key's
 * owner: same role, same workspaces, nothing the user couldn't already see
 * in the app. There is deliberately no tool that writes.
 */

interface McpWorkspace {
  id: string;
  name: string;
  slug: string;
  /** False when the user is a calling agent here (leads/pipeline only). */
  fullAccess: boolean;
}

/** Workspaces the principal can read — mirrors getWorkspaceContext, sans cookies. */
async function accessibleWorkspaces(p: ApiKeyPrincipal): Promise<McpWorkspace[]> {
  const cols = {
    id: schema.workspaces.id,
    name: schema.workspaces.name,
    slug: schema.workspaces.slug,
  };
  let rows: { id: string; name: string; slug: string }[];
  if (p.role === "client") {
    rows = await db()
      .select(cols)
      .from(schema.workspaces)
      .innerJoin(
        schema.workspaceMembers,
        eq(schema.workspaceMembers.workspaceId, schema.workspaces.id),
      )
      .where(
        and(
          eq(schema.workspaceMembers.userId, p.userId),
          eq(schema.workspaces.isActive, true),
        ),
      );
  } else if (p.role === "operations") {
    // Dispatch-only staff have no marketing data to read.
    rows = [];
  } else {
    rows = await db()
      .select(cols)
      .from(schema.workspaces)
      .where(eq(schema.workspaces.isActive, true));
  }
  const out: McpWorkspace[] = [];
  for (const w of rows) {
    out.push({ ...w, fullAccess: await hasFullAccess(p, w.id) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Same rule as isWorkspaceAgent, evaluated for the key's owner. */
async function hasFullAccess(p: { userId: string; role: Role }, workspaceId: string) {
  if (p.role === "agency_member") return false;
  if (isPlatformAdmin(p.role)) return true;
  return (await getWorkspaceRole(p.userId, workspaceId)) !== "agent";
}

class ToolError extends Error {}

/** Picks the workspace by slug, name or id; the only one when unambiguous. */
function pickWorkspace(list: McpWorkspace[], key: string | undefined): McpWorkspace {
  if (list.length === 0) throw new ToolError("You don't have access to any workspace.");
  if (!key) {
    if (list.length === 1) return list[0];
    throw new ToolError(
      `Specify \`workspace\`. Available: ${list.map((w) => w.slug).join(", ")}.`,
    );
  }
  const k = key.trim().toLowerCase();
  const found = list.find(
    (w) => w.slug.toLowerCase() === k || w.id === key || w.name.toLowerCase() === k,
  );
  if (!found) {
    throw new ToolError(
      `Unknown workspace "${key}". Available: ${list.map((w) => w.slug).join(", ")}.`,
    );
  }
  return found;
}

function requireFull(w: McpWorkspace) {
  if (!w.fullAccess) {
    throw new ToolError(
      `Your role in "${w.slug}" only allows leads and pipeline queries.`,
    );
  }
}

const dateArg = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .optional();

const rangeArgs = {
  from: dateArg.describe("Start date (YYYY-MM-DD, inclusive)."),
  to: dateArg.describe("End date (YYYY-MM-DD, inclusive)."),
  days: z
    .number()
    .int()
    .min(1)
    .max(365)
    .optional()
    .describe("Alternative to from/to: the last N days. Default 30."),
};

/** Resolves from/to/days into a concrete window (default: last 30 days). */
function resolveRange(a: { from?: string; to?: string; days?: number }) {
  if (a.from || a.to) {
    const start = a.from ? parseISO(a.from) : subDays(new Date(), 365);
    const end = a.to ? parseISO(a.to) : new Date();
    if (!isValid(start) || !isValid(end)) throw new ToolError("Invalid date.");
    return { start: startOfDay(start), end: endOfDay(end) };
  }
  const days = a.days ?? 30;
  return { start: startOfDay(subDays(new Date(), days)), end: endOfDay(new Date()) };
}

const wsArg = z
  .string()
  .optional()
  .describe("Workspace slug (see list_workspaces). Optional when you have only one.");

const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

/** Strips per-day series so agent rows stay small in tool output. */
const compactAgent = (row: AgentPerformanceRow): Omit<AgentPerformanceRow, "byDay"> => {
  const copy: Partial<AgentPerformanceRow> = { ...row };
  delete copy.byDay;
  return copy as Omit<AgentPerformanceRow, "byDay">;
};

export function createMcpServer(principal: ApiKeyPrincipal) {
  const server = new McpServer(
    { name: "vivo-marketing", version: "1.0.0" },
    {
      instructions:
        "Read-only access to the Vivo marketing platform (Meta lead-gen campaigns, leads, sales pipeline, agent activity). " +
        "Call list_workspaces first to learn which client workspaces you can query, then pass the workspace slug to the other tools. " +
        "Dates are YYYY-MM-DD; money is USD. Nothing here modifies data.",
    },
  );

  let cache: McpWorkspace[] | null = null;
  const workspaces = async () => (cache ??= await accessibleWorkspaces(principal));

  /** Wraps a tool body so expected errors come back as MCP tool errors, not crashes. */
  const guard =
    <A>(fn: (args: A) => Promise<ReturnType<typeof json>>) =>
    async (args: A) => {
      try {
        return await fn(args);
      } catch (e) {
        if (e instanceof ToolError) {
          return { isError: true, content: [{ type: "text" as const, text: e.message }] };
        }
        throw e;
      }
    };

  server.registerTool(
    "list_workspaces",
    {
      title: "List workspaces",
      description:
        "Client workspaces (companies) you can query, with your access level in each. Call this first.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    guard(async () =>
      json({
        user: { name: principal.name, email: principal.email, role: principal.role },
        workspaces: await workspaces(),
      }),
    ),
  );

  server.registerTool(
    "get_overview",
    {
      title: "Marketing overview",
      description:
        "KPIs for a period (spend, leads, cost per lead, CTR) with deltas vs the previous equal-length period, daily series, top campaigns and open AI insights.",
      inputSchema: { workspace: wsArg, ...rangeArgs },
      annotations: READ_ONLY,
    },
    guard(async (a) => {
      const w = pickWorkspace(await workspaces(), a.workspace);
      requireFull(w);
      const range = resolveRange(a);
      const o = await getOverview(w.id, range);
      return json({ workspace: w.slug, range, ...o });
    }),
  );

  server.registerTool(
    "list_campaigns",
    {
      title: "List campaigns",
      description:
        "Campaign performance table for a period: spend, impressions, clicks, leads, CPL and CPL trend (recent half vs earlier half of the window).",
      inputSchema: { workspace: wsArg, ...rangeArgs },
      annotations: READ_ONLY,
    },
    guard(async (a) => {
      const w = pickWorkspace(await workspaces(), a.workspace);
      requireFull(w);
      const range = resolveRange(a);
      return json({ workspace: w.slug, range, campaigns: await getCampaignRows(w.id, range) });
    }),
  );

  server.registerTool(
    "search_leads",
    {
      title: "Search leads",
      description:
        "Paginated leads list with optional free-text search (name, email, phone) and filters. Newest first. Use get_lead for full detail and history.",
      inputSchema: {
        workspace: wsArg,
        q: z.string().optional().describe("Free text over name, email and phone."),
        stage: z.string().optional().describe("Pipeline stage name (see get_pipeline)."),
        city: z.string().optional().describe("City reported by the lead."),
        campaign_id: z.string().optional(),
        from: rangeArgs.from.describe("Only leads created on/after this date."),
        to: rangeArgs.to.describe("Only leads created on/before this date."),
        page: z.number().int().min(1).optional(),
        page_size: z.number().int().min(1).max(100).optional().describe("Default 25."),
      },
      annotations: READ_ONLY,
    },
    guard(async (a) => {
      const w = pickWorkspace(await workspaces(), a.workspace);
      let stageId: string | null = null;
      if (a.stage) {
        const all = await db()
          .select({ id: schema.stages.id, name: schema.stages.name })
          .from(schema.stages)
          .where(eq(schema.stages.workspaceId, w.id));
        const hit = all.find((x) => x.name.toLowerCase() === a.stage!.toLowerCase());
        if (!hit) {
          throw new ToolError(
            `Unknown stage "${a.stage}". Stages: ${all.map((x) => x.name).join(", ")}.`,
          );
        }
        stageId = hit.id;
      }
      const page = await getLeadsPage(w.id, {
        q: a.q ?? null,
        stageId,
        city: a.city ?? null,
        campaignId: a.campaign_id ?? null,
        start: a.from ? startOfDay(parseISO(a.from)) : null,
        end: a.to ? endOfDay(parseISO(a.to)) : null,
        page: a.page,
        pageSize: a.page_size ?? 25,
      });
      // Trim the heavy per-row fields; get_lead has them.
      const rows = page.rows.map((r) => {
        const copy: Partial<typeof r> = { ...r };
        delete copy.formData;
        delete copy.formQuestions;
        delete copy.aiReason;
        return copy;
      });
      return json({ workspace: w.slug, ...page, rows });
    }),
  );

  server.registerTool(
    "get_lead",
    {
      title: "Get lead",
      description:
        "Full detail of one lead: contact data, form answers, AI score and reasoning, stage, RCA reason if lost, geo verdict, and its activity history (notes, calls, SMS, stage changes).",
      inputSchema: {
        workspace: wsArg,
        lead_id: z.string().describe("Lead id (from search_leads or get_pipeline)."),
      },
      annotations: READ_ONLY,
    },
    guard(async (a) => {
      const w = pickWorkspace(await workspaces(), a.workspace);
      const lead = await getLeadRowById(w.id, a.lead_id);
      if (!lead) throw new ToolError("Lead not found in this workspace.");
      const events = await db()
        .select({
          id: schema.leadEvents.id,
          type: schema.leadEvents.type,
          payload: schema.leadEvents.payload,
          by: schema.users.name,
          at: schema.leadEvents.createdAt,
        })
        .from(schema.leadEvents)
        .leftJoin(schema.users, eq(schema.users.id, schema.leadEvents.userId))
        .where(eq(schema.leadEvents.leadId, lead.id))
        .orderBy(desc(schema.leadEvents.createdAt))
        .limit(200);
      return json({ workspace: w.slug, lead, events });
    }),
  );

  server.registerTool(
    "get_pipeline",
    {
      title: "Pipeline summary",
      description:
        "Sales pipeline: stages in order with lead counts per stage, the Contractor Compliance sub-status breakdown, and (optionally) the newest cards in each column.",
      inputSchema: {
        workspace: wsArg,
        from: rangeArgs.from.describe("Only leads created on/after this date."),
        to: rangeArgs.to.describe("Only leads created on/before this date."),
        cities: z.array(z.string()).optional().describe("Ad-set target cities."),
        regions: z.array(z.string()).optional().describe("Ad-set target states."),
        include_cards: z
          .boolean()
          .optional()
          .describe("Also return up to `cards_per_stage` leads per stage. Default false."),
        cards_per_stage: z.number().int().min(1).max(50).optional().describe("Default 10."),
      },
      annotations: READ_ONLY,
    },
    guard(async (a) => {
      const w = pickWorkspace(await workspaces(), a.workspace);
      const data = await getPipeline(w.id, {
        cities: a.cities ?? null,
        regions: a.regions ?? null,
        start: a.from ? startOfDay(parseISO(a.from)) : null,
        end: a.to ? endOfDay(parseISO(a.to)) : null,
      });
      const perStage = a.cards_per_stage ?? 10;
      const stages = data.stages.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        workable: s.workable,
        count: data.counts[s.id] ?? 0,
        ...(a.include_cards
          ? { cards: (data.cardsByStage[s.id] ?? []).slice(0, perStage) }
          : {}),
      }));
      return json({ workspace: w.slug, stages, ccCounts: data.ccCounts });
    }),
  );

  server.registerTool(
    "find_in_pipeline",
    {
      title: "Find lead in pipeline",
      description:
        "Locate leads by name, email or phone fragment and see which stage each one is in.",
      inputSchema: { workspace: wsArg, query: z.string().min(2) },
      annotations: READ_ONLY,
    },
    guard(async (a) => {
      const w = pickWorkspace(await workspaces(), a.workspace);
      const cards = await searchPipelineLeads(w.id, a.query);
      const stageIds = [...new Set(cards.map((c) => c.stageId).filter(Boolean))] as string[];
      const names = stageIds.length
        ? await db()
            .select({ id: schema.stages.id, name: schema.stages.name })
            .from(schema.stages)
            .where(inArray(schema.stages.id, stageIds))
        : [];
      const byId = new Map(names.map((s) => [s.id, s.name]));
      return json({
        workspace: w.slug,
        results: cards.map((c) => ({ ...c, stageName: c.stageId ? byId.get(c.stageId) : null })),
      });
    }),
  );

  server.registerTool(
    "get_funnel_report",
    {
      title: "Funnel report",
      description:
        "Conversion funnel for leads created in a period: how many reached each stage, step-to-step conversion, and lost leads with their top RCA reasons.",
      inputSchema: {
        workspace: wsArg,
        ...rangeArgs,
        cities: z.array(z.string()).optional(),
        regions: z.array(z.string()).optional(),
      },
      annotations: READ_ONLY,
    },
    guard(async (a) => {
      const w = pickWorkspace(await workspaces(), a.workspace);
      requireFull(w);
      const range = resolveRange(a);
      const report = await getFunnelReport(w.id, {
        ...range,
        cities: a.cities ?? null,
        regions: a.regions ?? null,
      });
      return json({ workspace: w.slug, range, ...report });
    }),
  );

  server.registerTool(
    "get_agent_activity",
    {
      title: "Agent activity",
      description:
        "Per-agent outreach report for a period: touches by channel (call/SMS/WhatsApp/email), outcomes, leads worked, wins/losses, median time to first touch, and RingCentral call volume/talk time.",
      inputSchema: { workspace: wsArg, ...rangeArgs },
      annotations: READ_ONLY,
    },
    guard(async (a) => {
      const w = pickWorkspace(await workspaces(), a.workspace);
      requireFull(w);
      const range = resolveRange(a);
      const r = await getAgentPerformance(w.id, range);
      return json({ workspace: w.slug, range, totals: r.totals, agents: r.rows.map(compactAgent) });
    }),
  );

  server.registerTool(
    "get_sync_status",
    {
      title: "Sync status",
      description:
        "Ad-platform connections of a workspace and their most recent sync runs (status, timing, row counts, errors). Useful to explain stale or missing data.",
      inputSchema: { workspace: wsArg, limit: z.number().int().min(1).max(50).optional() },
      annotations: READ_ONLY,
    },
    guard(async (a) => {
      const w = pickWorkspace(await workspaces(), a.workspace);
      requireFull(w);
      const conns = await db()
        .select({
          id: schema.connections.id,
          platform: schema.connections.platform,
          accountId: schema.connections.accountId,
          accountName: schema.connections.accountName,
          status: schema.connections.status,
        })
        .from(schema.connections)
        .where(eq(schema.connections.workspaceId, w.id));
      const runs = conns.length
        ? await db()
            .select({
              connectionId: schema.syncRuns.connectionId,
              status: schema.syncRuns.status,
              startedAt: schema.syncRuns.startedAt,
              finishedAt: schema.syncRuns.finishedAt,
              stats: schema.syncRuns.stats,
              error: schema.syncRuns.error,
            })
            .from(schema.syncRuns)
            .where(inArray(schema.syncRuns.connectionId, conns.map((c) => c.id)))
            .orderBy(desc(schema.syncRuns.startedAt))
            .limit(a.limit ?? 10)
        : [];
      return json({ workspace: w.slug, connections: conns, recentRuns: runs });
    }),
  );

  return server;
}
