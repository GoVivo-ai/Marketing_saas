import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getAgentPerformance } from "@/lib/agent-report";
import { businessDay, endOfBusinessDay, startOfBusinessDay } from "@/lib/business-time";
import {
  getContactQueue,
  getLeadRowById,
  getLeadsPage,
  getPipeline,
  getWorkspaceContext,
} from "@/lib/data";
import { getDailyCallReport, localDay } from "@/lib/call-report";
import { getMailAccount } from "@/lib/mail-accounts";
import { isTemplateChannel, renderTemplate } from "@/lib/message-templates";
import { DISQUAL_PREFILL, OUTREACH_OUTCOMES, type OutreachOutcome } from "@/lib/outreach";
import { canManageWorkspace, isOperations } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { isRingCentralConnected } from "@/lib/settings";
import {
  claimLead,
  getLeadActivity,
  logLeadOutreach,
  releaseLead,
  scheduleLeadCallback,
  sendLeadEmail,
  setLeadDisqual,
  smsLead,
} from "@/lib/actions/leads";
import { listMessageTemplates } from "@/lib/actions/message-templates";
import { listRecentCalls, lookupLeadByPhone, sendSmsToNumber } from "@/lib/actions/phone";
import { getWorkspaceActivity, toCsvText } from "./reports";
import { issueRefreshToken, sessionFromRefreshToken } from "./session";

/**
 * The API the native apps (vivo-mobile) talk to: /api/mobile/v1/…
 *
 * It adds no business logic. Every endpoint is a thin JSON door onto a
 * function the web app already uses, so the apps and the browser can never
 * disagree about what a queue, a template or an outcome is. Authentication
 * is the web session cookie (see ./session.ts for how a phone keeps it).
 *
 * Versioned in the path: installed apps keep calling v1 long after the web
 * has moved on, so a breaking change means a v2 next to it, not an edit here.
 */

type Json = Record<string, unknown>;

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const fail = (status: number, error: string) => json({ error }, status);

async function body(req: NextRequest): Promise<Json> {
  const parsed = (await req.json().catch(() => null)) as unknown;
  return parsed && typeof parsed === "object" ? (parsed as Json) : {};
}
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export async function handleMobile(req: NextRequest, path: string[]): Promise<NextResponse> {
  const route = `${req.method} ${path.join("/")}`;
  try {
    // The one endpoint that works without a session: it is how an expired
    // one is replaced.
    if (route === "POST auth/refresh") return await refresh(req);

    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return fail(401, "Unauthorized");
    const role = (session.user as { role?: string }).role;

    switch (route) {
      case "POST auth/refresh-token": {
        const refreshToken = await issueRefreshToken(userId);
        return refreshToken ? json({ refreshToken }) : fail(401, "Unauthorized");
      }

      case "GET me": {
        const { active, workspaces } = await getWorkspaceContext();
        const [ringcentral, mail, canManage] = await Promise.all([
          isRingCentralConnected(userId),
          getMailAccount(userId).catch(() => null),
          active ? canManageWorkspace(active.id) : false,
        ]);
        return json({
          user: { id: userId, name: session.user?.name ?? null, email: session.user?.email ?? null, role },
          workspace: active ? { id: active.id, name: active.name } : null,
          workspaces: workspaces.map((w) => ({ id: w.id, name: w.name })),
          ringcentral,
          mailAddress: mail?.address ?? null,
          canManage,
          hasQueue: !!active && !isOperations(role),
        });
      }

      case "GET queue": {
        const { active } = await getWorkspaceContext();
        if (!active || isOperations(role)) return json({ items: [], total: 0 });
        const q = await getContactQueue(active.id);
        return json({
          total: q.total,
          items: q.items.map((i) => ({
            id: i.id,
            name: i.name,
            phone: i.phone,
            email: i.email,
            campaign: i.campaign,
            city: i.geo?.leadCity ?? i.geo?.targetCity ?? null,
            state: i.geo?.leadRegion ?? null,
            due: i.due,
            callBackAt: i.callBackAt,
            touches: i.touches,
            lastTouchAt: i.lastTouchAt,
            lastOutcome: i.lastOutcome,
            lastBy: i.lastBy,
            suggestedAction: i.aiSuggestedAction,
            priority: i.priorityMatch,
          })),
        });
      }

      case "GET calls/recent":
        return json({ calls: await listRecentCalls(40) });

      case "GET leads/lookup":
        return json({ lead: await lookupLeadByPhone(req.nextUrl.searchParams.get("phone") ?? "") });

      case "POST templates/render": {
        // Rendered here, not in the app, so the placeholder rules live once.
        const b = await body(req);
        if (!isTemplateChannel(b.channel)) return fail(400, "Invalid channel");
        const lead = (b.lead && typeof b.lead === "object" ? b.lead : {}) as Json;
        const { templates, agent } = await listMessageTemplates(b.channel);
        const vars = {
          name: str(lead.name) || null,
          city: str(lead.city) || null,
          state: str(lead.state) || null,
          campaign: str(lead.campaign) || null,
          ...agent,
        };
        return json({
          templates: templates.map((t) => ({
            id: t.id,
            name: t.name,
            subject: t.subject ? renderTemplate(t.subject, vars) : null,
            body: renderTemplate(t.body, vars),
          })),
        });
      }

      case "POST sms": {
        const b = await body(req);
        return json(await sendSmsToNumber(str(b.to), str(b.text)));
      }

      case "POST workspace": {
        // The active workspace is the same cookie the web's switcher writes.
        const b = await body(req);
        const { workspaces } = await getWorkspaceContext();
        const target = workspaces.find((w) => w.id === str(b.id));
        if (!target) return fail(403, "Forbidden");
        const res = json({ ok: true, workspace: { id: target.id, name: target.name } });
        res.cookies.set("ws", target.slug, {
          path: "/",
          sameSite: "lax",
          secure: req.nextUrl.protocol === "https:",
          maxAge: 365 * 24 * 3600,
        });
        return res;
      }

      case "GET admin/agents": {
        const { active } = await getWorkspaceContext();
        if (!active || !(await canManageWorkspace(active.id))) return fail(403, "Forbidden");
        // The last N business days, today included.
        const days = [1, 7, 30].includes(Number(req.nextUrl.searchParams.get("days")))
          ? Number(req.nextUrl.searchParams.get("days"))
          : 1;
        const start = startOfBusinessDay(businessDay(new Date(Date.now() - (days - 1) * 86_400_000)));
        const report = await getAgentPerformance(active.id, { start, end: new Date() });
        return json({
          days,
          workspace: active.name,
          totals: report.totals,
          agents: report.rows.map((r) => ({
            userId: r.userId,
            name: r.name,
            touches: r.touches,
            outcomes: r.outcomes,
            leadsWorked: r.leadsWorked,
            won: r.won,
            lost: r.lost,
            medianFirstTouchMin: r.medianFirstTouchMin,
            calls: r.rcCalls + r.rcOtherCalls,
            callsConnected: r.rcConnected,
            talkTimeSec: r.rcTalkTimeSec,
            byDay: Object.entries(r.byDay)
              .map(([day, v]) => ({ day, touches: v.touches, calls: v.calls }))
              .sort((a, b) => a.day.localeCompare(b.day)),
          })),
        });
      }

      case "GET admin/leads": {
        const { active } = await getWorkspaceContext();
        if (!active || !(await canManageWorkspace(active.id))) return fail(403, "Forbidden");
        const sp = req.nextUrl.searchParams;
        const q = sp.get("q")?.trim() || null;
        const stageId = sp.get("stage") || null;
        const page = Math.max(1, Number(sp.get("page")) || 1);
        const today = startOfBusinessDay(businessDay(new Date()));
        const week = new Date(today.getTime() - 6 * 86_400_000);
        // "Arrived in the last N days"; absent = all time.
        const days = Number(sp.get("days"));
        const since = days > 0 ? new Date(today.getTime() - (days - 1) * 86_400_000) : null;
        const [pipeline, queue, list, newToday, newWeek] = await Promise.all([
          getPipeline(active.id),
          getContactQueue(active.id),
          getLeadsPage(active.id, { q, stageId, start: since, page, pageSize: 30 }),
          getLeadsPage(active.id, { start: today, pageSize: 1 }),
          getLeadsPage(active.id, { start: week, pageSize: 1 }),
        ]);
        return json({
          workspace: active.name,
          newToday: newToday.total,
          newWeek: newWeek.total,
          queue: {
            total: queue.total,
            new: queue.newCount,
            followUp: queue.followUpCount,
            priority: queue.priorityCount,
            waiting: queue.coolingDown,
          },
          stages: pipeline.stages.map((st) => ({
            id: st.id,
            name: st.name,
            color: st.color,
            kind: st.kind,
            count: pipeline.counts[st.id] ?? 0,
          })),
          total: list.total,
          page: list.page,
          totalPages: list.totalPages,
          leads: list.rows.map((l) => ({
            id: l.id,
            name: l.name,
            phone: l.phone,
            campaign: l.campaign,
            stageName: l.stageName,
            stageColor: l.stageColor,
            score: l.aiScore,
            createdAt: l.createdAt,
          })),
        });
      }

      case "GET admin/activity": {
        const { active } = await getWorkspaceContext();
        if (!active || !(await canManageWorkspace(active.id))) return fail(403, "Forbidden");
        const sp = req.nextUrl.searchParams;
        // One business day, or a from–to range of them; today by default.
        const isDay = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
        const today = businessDay(new Date());
        const from = isDay(sp.get("from")) ? sp.get("from")! : isDay(sp.get("day")) ? sp.get("day")! : today;
        const to = isDay(sp.get("to")) ? sp.get("to")! : from;
        const csv = sp.get("format") === "csv";
        const entries = await getWorkspaceActivity(active.id, {
          start: startOfBusinessDay(from),
          end: endOfBusinessDay(to),
          agentId: sp.get("agent") || null,
          limit: csv ? 5000 : 500,
        });
        if (csv)
          return json({
            filename: `activity-${from}${to !== from ? `-to-${to}` : ""}.csv`,
            csv: toCsvText(
              ["When", "Agent", "Lead", "Lead ID", "Action", "Outcome", "Detail"],
              entries.map((e) => [e.at, e.agentName, e.leadName, e.leadId, e.type, e.outcome, e.text]),
            ),
          });
        return json({ from, to, today, workspace: active.name, entries });
      }

      case "GET admin/leads/export": {
        const { active } = await getWorkspaceContext();
        if (!active || !(await canManageWorkspace(active.id))) return fail(403, "Forbidden");
        const sp = req.nextUrl.searchParams;
        const days = Number(sp.get("days"));
        const today = startOfBusinessDay(businessDay(new Date()));
        const opts = {
          q: sp.get("q")?.trim() || null,
          stageId: sp.get("stage") || null,
          start: days > 0 ? new Date(today.getTime() - (days - 1) * 86_400_000) : null,
          pageSize: 200,
        };
        // Same filters as the list on screen, every page of it (to a ceiling).
        const rows = [];
        for (let page = 1; page <= 25; page++) {
          const chunk = await getLeadsPage(active.id, { ...opts, page });
          rows.push(...chunk.rows);
          if (page >= chunk.totalPages) break;
        }
        return json({
          filename: `leads-${businessDay(new Date())}.csv`,
          count: rows.length,
          csv: toCsvText(
            ["Lead ID", "Name", "Phone", "Email", "Stage", "Campaign", "Source", "Score", "Assigned to", "Created"],
            rows.map((l) => [
              l.id, l.name, l.phone, l.email, l.stageName, l.campaign, l.source, l.aiScore, l.assignedTo,
              l.createdAt.toISOString(),
            ]),
          ),
        });
      }

      case "GET admin/daily": {
        const { active } = await getWorkspaceContext();
        if (!active || !(await canManageWorkspace(active.id))) return fail(403, "Forbidden");
        // One operating day, in the report's own timezone; today by default.
        const day = req.nextUrl.searchParams.get("day") ?? localDay(new Date());
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return fail(400, "Invalid day");
        const start = new Date(`${day}T00:00:00Z`);
        const report = await getDailyCallReport(active.id, {
          // A day either side so the report's timezone, not UTC, decides.
          start: new Date(start.getTime() - 24 * 3600_000),
          end: new Date(start.getTime() + 48 * 3600_000),
        });
        const rows = report.rows.filter((r) => r.day === day);
        return json({
          day,
          workspace: active.name,
          agents: rows.map((r) => ({
            userId: r.userId,
            name: r.name,
            firstCall: r.firstCall,
            lastCall: r.lastCall,
            outbound: r.outbound,
            uniqueLeads: r.uniqueLeads,
            realConversations: r.realConversations,
            contactRatePct: r.contactRatePct,
            inbound: r.inbound,
            inboundMissed: r.inboundMissed,
            talkTimeSec: r.talkTimeSec,
            profilesCreated: r.profilesCreated,
            inactiveMin: r.inactiveMin,
            gaps: r.gaps.length,
          })),
        });
      }
    }

    // GET admin/leads/:id — one lead and everything that has happened to it.
    if (req.method === "GET" && path.length === 3 && path[0] === "admin" && path[1] === "leads") {
      const { active } = await getWorkspaceContext();
      if (!active || !(await canManageWorkspace(active.id))) return fail(403, "Forbidden");
      const lead = await getLeadRowById(active.id, path[2]);
      if (!lead) return fail(404, "Not found");
      return json({
        lead: {
          id: lead.id,
          name: lead.name,
          phone: lead.phone,
          email: lead.email,
          campaign: lead.campaign,
          source: lead.source,
          stageName: lead.stageName,
          stageColor: lead.stageColor,
          score: lead.aiScore,
          scoreReason: lead.aiReason,
          suggestedAction: lead.aiSuggestedAction,
          assignedTo: lead.assignedTo,
          createdAt: lead.createdAt,
        },
        activity: await getLeadActivity(lead.id),
      });
    }

    // POST leads/:id/:action
    if (req.method === "POST" && path.length === 3 && path[0] === "leads") {
      const [, leadId, action] = path;
      const b = await body(req);
      switch (action) {
        case "claim":
          return json(await claimLead(leadId));
        case "release":
          await releaseLead(leadId);
          return json({ ok: true });
        case "outreach": {
          const outcome = str(b.outcome) as OutreachOutcome;
          if (!OUTREACH_OUTCOMES.includes(outcome)) return fail(400, "Invalid outcome");
          const logged = await logLeadOutreach(leadId, {
            channel: "call",
            outcome,
            note: str(b.note) || undefined,
          });
          if (!logged.ok) return json(logged);
          // Terminal outcomes carry their RCA reason, as on the web queue.
          const reason = DISQUAL_PREFILL[outcome];
          if (reason) {
            const d = await setLeadDisqual(leadId, reason);
            if (!d.ok) return json(d);
          }
          return json(logged);
        }
        case "callback":
          return json(
            await scheduleLeadCallback(leadId, { at: str(b.at), note: str(b.note) || undefined }),
          );
        case "sms":
          return json(await smsLead(leadId, str(b.text)));
        case "email":
          return json(await sendLeadEmail(leadId, { subject: str(b.subject), body: str(b.body) }));
      }
    }

    return fail(404, "Not found");
  } catch (err) {
    // The shared functions signal "not yours" by throwing; anything else is ours.
    const message = err instanceof Error ? err.message : "";
    if (/unauthorized/i.test(message)) return fail(401, "Unauthorized");
    if (/forbidden|not found|access/i.test(message)) return fail(403, "Forbidden");
    console.error(`[mobile-api] ${route}`, err);
    return fail(500, "Something went wrong");
  }
}

async function refresh(req: NextRequest): Promise<NextResponse> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(`mobile-refresh:${ip}`, 30, 15 * 60_000)) return fail(429, "Too many attempts");
  const b = await body(req);
  const secure = req.nextUrl.protocol === "https:";
  const cookie = await sessionFromRefreshToken(str(b.refreshToken), secure);
  if (!cookie) return fail(401, "Unauthorized");
  const res = json({ ok: true });
  res.cookies.set(cookie.name, cookie.value, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: cookie.maxAge,
  });
  return res;
}
