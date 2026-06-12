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
  /** Per-city goals (in the workspace's result unit). */
  cityTargets?: { cityName: string; targetResults: number }[];
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

  // Replace the month's per-city goals with the submitted set.
  await db()
    .delete(schema.planCityTargets)
    .where(
      and(
        eq(schema.planCityTargets.workspaceId, input.workspaceId),
        eq(schema.planCityTargets.month, month),
      ),
    );
  const rows = (input.cityTargets ?? [])
    .filter((c) => c.cityName && c.targetResults > 0)
    .map((c) => ({
      workspaceId: input.workspaceId,
      month,
      cityName: c.cityName,
      targetResults: Math.round(clamp(c.targetResults)),
    }));
  if (rows.length) await db().insert(schema.planCityTargets).values(rows);

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

  const monthDate = `${month}-01`;
  await db()
    .delete(schema.monthlyPlans)
    .where(
      and(
        eq(schema.monthlyPlans.workspaceId, workspaceId),
        eq(schema.monthlyPlans.month, monthDate),
      ),
    );
  await db()
    .delete(schema.planCityTargets)
    .where(
      and(
        eq(schema.planCityTargets.workspaceId, workspaceId),
        eq(schema.planCityTargets.month, monthDate),
      ),
    );

  revalidatePath("/planner");
  return { ok: true };
}
