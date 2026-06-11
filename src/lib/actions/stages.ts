"use server";

import { revalidatePath } from "next/cache";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { canManageWorkspace } from "@/lib/permissions";

const PALETTE = ["#011640", "#026a60", "#04d98b", "#2bbf9a", "#64dc54", "#f2e205"];

/** Resolves a stage's workspace and checks management permission. */
async function requireStageManager(stageId: string): Promise<string> {
  const [stage] = await db()
    .select({ workspaceId: schema.stages.workspaceId })
    .from(schema.stages)
    .where(eq(schema.stages.id, stageId))
    .limit(1);
  if (!stage) throw new Error("Stage not found");
  if (!(await canManageWorkspace(stage.workspaceId)))
    throw new Error("You don't have permission to manage stages");
  return stage.workspaceId;
}

function revalidate() {
  revalidatePath("/leads/pipeline");
  revalidatePath("/leads");
}

/** Adds a new open stage at the end of the funnel. */
export async function createStage(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!(await canManageWorkspace(workspaceId)))
    throw new Error("You don't have permission to manage stages");
  if (!name) throw new Error("Stage name is required");

  const [{ max }] = await db()
    .select({ max: sql<number>`coalesce(max(${schema.stages.position}), -1)::int` })
    .from(schema.stages)
    .where(eq(schema.stages.workspaceId, workspaceId));
  const position = max + 1;

  await db().insert(schema.stages).values({
    workspaceId,
    name,
    kind: "open",
    color: PALETTE[position % PALETTE.length],
    position,
  });
  revalidate();
}

/** Renames and/or recolors a stage. */
export async function updateStage(formData: FormData) {
  const stageId = String(formData.get("stageId") ?? "");
  await requireStageManager(stageId);
  const name = String(formData.get("name") ?? "").trim();
  const color = String(formData.get("color") ?? "").trim();
  if (!name) throw new Error("Stage name is required");
  await db()
    .update(schema.stages)
    .set({ name, color: color || null })
    .where(eq(schema.stages.id, stageId));
  revalidate();
}

/** Moves a stage one slot left or right by swapping positions with its neighbor. */
export async function moveStage(formData: FormData) {
  const stageId = String(formData.get("stageId") ?? "");
  const direction = String(formData.get("direction") ?? "");
  const workspaceId = await requireStageManager(stageId);

  const stages = await db()
    .select({ id: schema.stages.id, position: schema.stages.position })
    .from(schema.stages)
    .where(eq(schema.stages.workspaceId, workspaceId))
    .orderBy(asc(schema.stages.position));
  const idx = stages.findIndex((s) => s.id === stageId);
  const swapWith = direction === "left" ? idx - 1 : idx + 1;
  if (idx < 0 || swapWith < 0 || swapWith >= stages.length) return;

  const a = stages[idx];
  const b = stages[swapWith];
  await db().update(schema.stages).set({ position: b.position }).where(eq(schema.stages.id, a.id));
  await db().update(schema.stages).set({ position: a.position }).where(eq(schema.stages.id, b.id));
  revalidate();
}

/** Deletes a stage after re-homing its leads to an adjacent stage. */
export async function deleteStage(formData: FormData) {
  const stageId = String(formData.get("stageId") ?? "");
  const workspaceId = await requireStageManager(stageId);

  const stages = await db()
    .select({ id: schema.stages.id, position: schema.stages.position })
    .from(schema.stages)
    .where(eq(schema.stages.workspaceId, workspaceId))
    .orderBy(asc(schema.stages.position));
  if (stages.length <= 1) throw new Error("A pipeline needs at least one stage");

  const idx = stages.findIndex((s) => s.id === stageId);
  const target = stages[idx - 1] ?? stages[idx + 1];
  await db()
    .update(schema.leads)
    .set({ stageId: target.id })
    .where(eq(schema.leads.stageId, stageId));
  await db().delete(schema.stages).where(eq(schema.stages.id, stageId));
  revalidate();
}
