"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db";
import { canManageWorkspace } from "@/lib/permissions";

export interface SavePlanInput {
  workspaceId: string;
  /** Planned month as "YYYY-MM". */
  month: string;
  budget: number;
  targetCpl: number;
  /** Lead → sale conversion rate as a fraction (0.15 = 15%). */
  conversionRate: number;
  targetLeads: number;
  targetSales: number;
  notes?: string | null;
}

const clamp = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/** Upsert the monthly plan for a workspace. Agency users or the owner only. */
export async function saveMonthlyPlan(
  input: SavePlanInput,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await canManageWorkspace(input.workspaceId))) {
    return { ok: false, error: "You don't have permission to edit this plan." };
  }
  if (!/^\d{4}-\d{2}$/.test(input.month)) {
    return { ok: false, error: "Invalid month." };
  }

  const month = `${input.month}-01`;
  const fields = {
    budget: clamp(input.budget).toFixed(2),
    targetCpl: clamp(input.targetCpl).toFixed(2),
    conversionRate: clamp(input.conversionRate).toFixed(4),
    targetLeads: Math.round(clamp(input.targetLeads)),
    targetSales: Math.round(clamp(input.targetSales)),
    notes: input.notes?.trim() || null,
  };

  await db()
    .insert(schema.monthlyPlans)
    .values({ workspaceId: input.workspaceId, month, ...fields })
    .onConflictDoUpdate({
      target: [schema.monthlyPlans.workspaceId, schema.monthlyPlans.month],
      set: { ...fields, updatedAt: new Date() },
    });

  revalidatePath("/planner");
  return { ok: true };
}

/** Deletes the saved plan for a workspace + month. Does not touch actuals. */
export async function deleteMonthlyPlan(
  workspaceId: string,
  month: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await canManageWorkspace(workspaceId))) {
    return { ok: false, error: "You don't have permission to edit this plan." };
  }
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return { ok: false, error: "Invalid month." };
  }

  await db()
    .delete(schema.monthlyPlans)
    .where(
      and(
        eq(schema.monthlyPlans.workspaceId, workspaceId),
        eq(schema.monthlyPlans.month, `${month}-01`),
      ),
    );

  revalidatePath("/planner");
  return { ok: true };
}
