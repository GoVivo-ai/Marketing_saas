import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * Read models for the supervisors' app that the web has no single function
 * for: the workspace's activity as one chronological log.
 */

const ACTIVITY_TYPES = ["call", "sms", "whatsapp", "email", "note", "status_change", "disqualified"];

export interface ActivityEntry {
  id: string;
  at: string;
  /** call | sms | whatsapp | email | note | status_change | disqualified */
  type: string;
  outcome: string | null;
  /** The agent's note, the message sent, or what changed. */
  text: string | null;
  agentId: string | null;
  agentName: string | null;
  leadId: string;
  leadName: string;
}

/**
 * Everything logged on the workspace's leads inside the window, newest first:
 * who did what, to which lead, and how it went. `agentId` narrows it to one
 * person. Capped so a busy month cannot become a multi-megabyte response.
 */
export async function getWorkspaceActivity(
  workspaceId: string,
  opts: { start: Date; end: Date; agentId?: string | null; limit?: number },
): Promise<ActivityEntry[]> {
  const filters = [
    eq(schema.leads.workspaceId, workspaceId),
    inArray(schema.leadEvents.type, ACTIVITY_TYPES),
    gte(schema.leadEvents.createdAt, opts.start),
    lte(schema.leadEvents.createdAt, opts.end),
  ];
  if (opts.agentId) filters.push(eq(schema.leadEvents.userId, opts.agentId));

  const [rows, stages] = await Promise.all([
    db()
      .select({
        id: schema.leadEvents.id,
        type: schema.leadEvents.type,
        payload: schema.leadEvents.payload,
        createdAt: schema.leadEvents.createdAt,
        agentId: schema.leadEvents.userId,
        agentName: schema.users.name,
        leadId: schema.leads.id,
        leadName: schema.leads.name,
      })
      .from(schema.leadEvents)
      .innerJoin(schema.leads, eq(schema.leadEvents.leadId, schema.leads.id))
      .leftJoin(schema.users, eq(schema.leadEvents.userId, schema.users.id))
      .where(and(...filters))
      .orderBy(desc(schema.leadEvents.createdAt))
      .limit(Math.min(Math.max(opts.limit ?? 500, 1), 5000)),
    db()
      .select({ id: schema.stages.id, name: schema.stages.name })
      .from(schema.stages)
      .where(eq(schema.stages.workspaceId, workspaceId)),
  ]);
  const stageName = new Map(stages.map((s) => [s.id, s.name]));

  return rows.map((r) => {
    const p = (r.payload ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    let text: string | null;
    if (r.type === "status_change") {
      const to = stageName.get(String(p.toStageId ?? ""));
      text = to ? `Moved to ${to}` : "Stage changed";
    } else if (r.type === "disqualified") {
      text = [p.l1, p.l2, p.l3].filter(Boolean).join(" › ") || null;
    } else if (r.type === "email") {
      text = str(p.subject) ?? str(p.note) ?? str(p.text);
    } else {
      text = str(p.note) ?? str(p.text);
    }
    return {
      id: r.id,
      at: r.createdAt.toISOString(),
      type: r.type,
      outcome: str(p.outcome),
      text: text && text.length > 400 ? `${text.slice(0, 400).trimEnd()}…` : text,
      agentId: r.agentId,
      agentName: r.agentName,
      leadId: r.leadId,
      leadName: r.leadName ?? "Lead",
    };
  });
}

/** RFC 4180 CSV, with a BOM so Excel reads accents correctly. */
export function toCsvText(header: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    const s = v === null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${[header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}
