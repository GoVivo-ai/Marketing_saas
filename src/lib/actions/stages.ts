"use server";

import { revalidatePath } from "next/cache";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { canManageWorkspace } from "@/lib/permissions";

const PALETTE = ["#011640", "#026a60", "#04d98b", "#2bbf9a", "#64dc54", "#f2e205"];

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

/**
 * Saves the whole stage editor in one submit: every row's name/color/kind,
 * plus an optional `move` ("up:<id>" / "down:<id>") or `delete` ("<id>") when
 * an arrow or the delete confirmation submitted the form — so reordering or
 * deleting never loses pending edits.
 */
export async function saveStages(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  if (!(await canManageWorkspace(workspaceId)))
    throw new Error("You don't have permission to manage stages");

  const stages = await db()
    .select()
    .from(schema.stages)
    .where(eq(schema.stages.workspaceId, workspaceId))
    .orderBy(asc(schema.stages.position));

  // 1) Field edits — apply for every row present in the form.
  for (const s of stages) {
    if (!formData.has(`name:${s.id}`)) continue;
    const name = String(formData.get(`name:${s.id}`) ?? "").trim();
    const color = String(formData.get(`color:${s.id}`) ?? "").trim() || null;
    const rawKind = String(formData.get(`kind:${s.id}`) ?? "").trim();
    const kind = ["open", "won", "lost"].includes(rawKind) ? rawKind : s.kind;
    if (!name) continue; // never blank out a stage name
    if (name !== s.name || color !== s.color || kind !== s.kind) {
      await db()
        .update(schema.stages)
        .set({ name, color, kind })
        .where(eq(schema.stages.id, s.id));
    }
  }

  // 2) Optional reorder — "up" = earlier in the funnel (left on the board).
  const move = String(formData.get("move") ?? "");
  if (move) {
    const [direction, stageId] = move.split(":");
    const idx = stages.findIndex((s) => s.id === stageId);
    const swapWith = direction === "up" ? idx - 1 : idx + 1;
    if (idx >= 0 && swapWith >= 0 && swapWith < stages.length) {
      const a = stages[idx];
      const b = stages[swapWith];
      await db().update(schema.stages).set({ position: b.position }).where(eq(schema.stages.id, a.id));
      await db().update(schema.stages).set({ position: a.position }).where(eq(schema.stages.id, b.id));
    }
  }

  // 3) Optional delete — re-home its leads to the adjacent stage first.
  const del = String(formData.get("delete") ?? "");
  if (del && stages.length > 1) {
    const idx = stages.findIndex((s) => s.id === del);
    if (idx >= 0) {
      const target = stages[idx - 1] ?? stages[idx + 1];
      await db()
        .update(schema.leads)
        .set({ stageId: target.id })
        .where(eq(schema.leads.stageId, del));
      await db().delete(schema.stages).where(eq(schema.stages.id, del));
    }
  }

  revalidate();
}
