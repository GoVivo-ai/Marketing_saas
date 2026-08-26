"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { auth } from "@/lib/auth";
import { canManageWorkspace } from "@/lib/permissions";
import { isDemoSession, DEMO_BLOCKED_MSG } from "@/lib/demo";

export type PromptTemplateResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * Saves the given scoring prompt as a named template. If the workspace
 * already has a template with that name, its content is updated instead
 * (same-name save = edit), keeping the original creator.
 */
export async function savePromptTemplate(
  workspaceId: string,
  name: string,
  content: string,
): Promise<PromptTemplateResult> {
  const session = await auth();
  if (!(await canManageWorkspace(workspaceId)))
    return { ok: false, error: "You don't have permission to manage this workspace" };
  if (await isDemoSession()) return { ok: false, error: DEMO_BLOCKED_MSG };
  const cleanName = name.trim();
  const cleanContent = content.trim();
  if (!cleanName) return { ok: false, error: "Give the template a name" };
  if (!cleanContent) return { ok: false, error: "The prompt is empty" };

  const [row] = await db()
    .insert(schema.promptTemplates)
    .values({
      workspaceId,
      name: cleanName,
      content: cleanContent,
      createdById: session?.user?.id ?? null,
    })
    .onConflictDoUpdate({
      target: [schema.promptTemplates.workspaceId, schema.promptTemplates.name],
      set: { content: cleanContent, updatedAt: new Date() },
    })
    .returning({ id: schema.promptTemplates.id });

  revalidatePath("/campaigns", "layout");
  return { ok: true, id: row.id };
}

export async function deletePromptTemplate(
  workspaceId: string,
  templateId: string,
): Promise<PromptTemplateResult> {
  if (!(await canManageWorkspace(workspaceId)))
    return { ok: false, error: "You don't have permission to manage this workspace" };
  if (await isDemoSession()) return { ok: false, error: DEMO_BLOCKED_MSG };
  await db()
    .delete(schema.promptTemplates)
    .where(
      and(
        eq(schema.promptTemplates.id, templateId),
        eq(schema.promptTemplates.workspaceId, workspaceId),
      ),
    );
  revalidatePath("/campaigns", "layout");
  return { ok: true, id: templateId };
}
