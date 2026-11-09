"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getWorkspaceContext } from "@/lib/data";
import { canManageWorkspace } from "@/lib/permissions";
import { isDemoSession, DEMO_BLOCKED_MSG } from "@/lib/demo";
import { getMailAccount } from "@/lib/mail-accounts";
import {
  formatPhoneForText,
  isTemplateChannel,
  type TemplateChannel,
} from "@/lib/message-templates";

export interface MessageTemplate {
  id: string;
  channel: TemplateChannel;
  name: string;
  subject: string | null;
  body: string;
  sortOrder: number;
  updatedAt: Date;
}

/** Who's writing — fills {agent_*} in the picker. */
export interface AgentVars {
  /** The active workspace's name — fills {company}. */
  company: string | null;
  agentName: string | null;
  agentPhone: string | null;
  agentEmail: string | null;
}

export type MessageTemplateResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * Templates of the active workspace for one channel, plus the current
 * agent's signature values. Any member can read them — agents are the
 * ones who send.
 */
export async function listMessageTemplates(
  channel: TemplateChannel,
): Promise<{ templates: MessageTemplate[]; agent: AgentVars }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Unauthorized");
  const { active } = await getWorkspaceContext();
  if (!active)
    return {
      templates: [],
      agent: { company: null, agentName: null, agentPhone: null, agentEmail: null },
    };

  const [rows, user, mail] = await Promise.all([
    db()
      .select({
        id: schema.messageTemplates.id,
        channel: schema.messageTemplates.channel,
        name: schema.messageTemplates.name,
        subject: schema.messageTemplates.subject,
        body: schema.messageTemplates.body,
        sortOrder: schema.messageTemplates.sortOrder,
        updatedAt: schema.messageTemplates.updatedAt,
      })
      .from(schema.messageTemplates)
      .where(
        and(
          eq(schema.messageTemplates.workspaceId, active.id),
          eq(schema.messageTemplates.channel, channel),
        ),
      )
      .orderBy(asc(schema.messageTemplates.sortOrder), asc(schema.messageTemplates.name)),
    db()
      .select({
        name: schema.users.name,
        email: schema.users.email,
        rcFromNumber: schema.users.rcFromNumber,
        dpFromNumber: schema.users.dpFromNumber,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1)
      .then((r) => r[0] ?? null),
    getMailAccount(userId).catch(() => null),
  ]);

  return {
    templates: rows.map((r) => ({ ...r, channel: r.channel as TemplateChannel })),
    agent: {
      company: active.name,
      agentName: user?.name ?? session?.user?.name ?? null,
      agentPhone: formatPhoneForText(user?.rcFromNumber ?? user?.dpFromNumber) || null,
      // Prefer the mailbox they actually send from.
      agentEmail: mail?.address ?? user?.email ?? null,
    },
  };
}

/** All templates of a workspace, for the Settings editor (managers). */
export async function listAllMessageTemplates(workspaceId: string): Promise<MessageTemplate[]> {
  if (!(await canManageWorkspace(workspaceId))) throw new Error("Forbidden");
  const rows = await db()
    .select({
      id: schema.messageTemplates.id,
      channel: schema.messageTemplates.channel,
      name: schema.messageTemplates.name,
      subject: schema.messageTemplates.subject,
      body: schema.messageTemplates.body,
      sortOrder: schema.messageTemplates.sortOrder,
      updatedAt: schema.messageTemplates.updatedAt,
    })
    .from(schema.messageTemplates)
    .where(eq(schema.messageTemplates.workspaceId, workspaceId))
    .orderBy(
      asc(schema.messageTemplates.channel),
      asc(schema.messageTemplates.sortOrder),
      asc(schema.messageTemplates.name),
    );
  return rows.map((r) => ({ ...r, channel: r.channel as TemplateChannel }));
}

export async function saveMessageTemplate(
  workspaceId: string,
  input: {
    id?: string | null;
    channel: string;
    name: string;
    subject?: string | null;
    body: string;
    sortOrder?: number;
  },
): Promise<MessageTemplateResult> {
  const session = await auth();
  if (!(await canManageWorkspace(workspaceId)))
    return { ok: false, error: "You don't have permission to manage this workspace" };
  if (await isDemoSession()) return { ok: false, error: DEMO_BLOCKED_MSG };
  if (!isTemplateChannel(input.channel)) return { ok: false, error: "Pick SMS or Email" };

  const name = input.name.trim();
  const body = input.body.trim();
  const subject = input.channel === "email" ? (input.subject ?? "").trim() || null : null;
  if (!name) return { ok: false, error: "Give the template a name" };
  if (name.length > 80) return { ok: false, error: "Name is too long (80 chars max)" };
  if (!body) return { ok: false, error: "The message is empty" };
  if (body.length > 10_000) return { ok: false, error: "Message is too long (10,000 chars max)" };
  if (subject && subject.length > 200) return { ok: false, error: "Subject is too long (200 chars max)" };
  const sortOrder = Number.isFinite(input.sortOrder) ? Math.trunc(input.sortOrder!) : 0;

  // Same name on the same channel is a duplicate — unless it's this very row.
  const [clash] = await db()
    .select({ id: schema.messageTemplates.id })
    .from(schema.messageTemplates)
    .where(
      and(
        eq(schema.messageTemplates.workspaceId, workspaceId),
        eq(schema.messageTemplates.channel, input.channel),
        eq(schema.messageTemplates.name, name),
      ),
    )
    .limit(1);
  if (clash && clash.id !== input.id)
    return { ok: false, error: `There's already a ${input.channel.toUpperCase()} template called "${name}"` };

  let id: string;
  if (input.id) {
    const [row] = await db()
      .update(schema.messageTemplates)
      .set({ name, subject, body, sortOrder, channel: input.channel, updatedAt: new Date() })
      .where(
        and(
          eq(schema.messageTemplates.id, input.id),
          eq(schema.messageTemplates.workspaceId, workspaceId),
        ),
      )
      .returning({ id: schema.messageTemplates.id });
    if (!row) return { ok: false, error: "That template no longer exists" };
    id = row.id;
  } else {
    const [row] = await db()
      .insert(schema.messageTemplates)
      .values({
        workspaceId,
        channel: input.channel,
        name,
        subject,
        body,
        sortOrder,
        createdById: session?.user?.id ?? null,
      })
      .returning({ id: schema.messageTemplates.id });
    id = row.id;
  }
  revalidatePath("/settings/templates");
  return { ok: true, id };
}

export async function deleteMessageTemplate(
  workspaceId: string,
  templateId: string,
): Promise<MessageTemplateResult> {
  if (!(await canManageWorkspace(workspaceId)))
    return { ok: false, error: "You don't have permission to manage this workspace" };
  if (await isDemoSession()) return { ok: false, error: DEMO_BLOCKED_MSG };
  await db()
    .delete(schema.messageTemplates)
    .where(
      and(
        eq(schema.messageTemplates.id, templateId),
        eq(schema.messageTemplates.workspaceId, workspaceId),
      ),
    );
  revalidatePath("/settings/templates");
  return { ok: true, id: templateId };
}
