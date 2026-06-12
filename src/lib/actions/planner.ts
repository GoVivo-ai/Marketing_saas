"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db";
import { canManageWorkspace } from "@/lib/permissions";
import { decryptSecret } from "@/lib/crypto";
import { getSecret } from "@/lib/settings";
import { searchGeoCities, type GeoCitySuggestion } from "@/lib/integrations/meta";

export interface SavePlanInput {
  workspaceId: string;
  /** Saved plan to update; omit to create a new plan from the canvas. */
  planId?: string | null;
  /** User-facing plan name; falls back to the month label when blank. */
  name?: string | null;
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
  cityTargets?: { cityName: string; region?: string | null; targetResults: number }[];
  /** Optional campaign window ("YYYY-MM-DD"); null clears it (full month). */
  periodStart?: string | null;
  periodEnd?: string | null;
}

const isoDate = (s: string | null | undefined) =>
  s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;

const clamp = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const monthLabel = (month: string) =>
  `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** Loads a plan, verifying it belongs to the workspace. */
async function findPlan(workspaceId: string, planId: string) {
  const rows = await db()
    .select()
    .from(schema.monthlyPlans)
    .where(
      and(
        eq(schema.monthlyPlans.id, planId),
        eq(schema.monthlyPlans.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * Saves the canvas as a plan — creates a new one or updates `planId`.
 * Agency users or the owner only. Returns the saved plan's id.
 */
export async function savePlan(
  input: SavePlanInput,
): Promise<{ ok: boolean; planId?: string; error?: string }> {
  if (!(await canManageWorkspace(input.workspaceId))) {
    return { ok: false, error: "You don't have permission to edit this plan." };
  }
  if (!/^\d{4}-\d{2}$/.test(input.month)) {
    return { ok: false, error: "Invalid month." };
  }

  const month = `${input.month}-01`;
  const fields = {
    name: input.name?.trim() || monthLabel(input.month),
    month,
    budget: clamp(input.budget).toFixed(2),
    targetCpl: clamp(input.targetCpl).toFixed(2),
    conversionRate: clamp(input.conversionRate).toFixed(4),
    targetLeads: Math.round(clamp(input.targetLeads)),
    targetSales: Math.round(clamp(input.targetSales)),
    notes: input.notes?.trim() || null,
    periodStart: isoDate(input.periodStart),
    periodEnd: isoDate(input.periodEnd),
  };

  let planId = input.planId ?? null;
  if (planId) {
    if (!(await findPlan(input.workspaceId, planId))) {
      return { ok: false, error: "Plan not found." };
    }
    await db()
      .update(schema.monthlyPlans)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(schema.monthlyPlans.id, planId));
    // Replace the plan's per-city goals with the submitted set.
    await db()
      .delete(schema.planCityTargets)
      .where(eq(schema.planCityTargets.planId, planId));
  } else {
    const inserted = await db()
      .insert(schema.monthlyPlans)
      .values({ workspaceId: input.workspaceId, ...fields })
      .returning({ id: schema.monthlyPlans.id });
    planId = inserted[0].id;
  }

  const rows = (input.cityTargets ?? [])
    .filter((c) => c.cityName && c.targetResults > 0)
    .map((c) => ({
      workspaceId: input.workspaceId,
      planId: planId!,
      month,
      cityName: c.cityName,
      region: c.region?.trim() || null,
      targetResults: Math.round(clamp(c.targetResults)),
    }));
  if (rows.length) await db().insert(schema.planCityTargets).values(rows);

  revalidatePath("/planner");
  return { ok: true, planId };
}

/** Deletes a saved plan and its city goals. Does not touch actuals. */
export async function deletePlan(
  workspaceId: string,
  planId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await canManageWorkspace(workspaceId))) {
    return { ok: false, error: "You don't have permission to edit this plan." };
  }
  if (!(await findPlan(workspaceId, planId))) {
    return { ok: false, error: "Plan not found." };
  }

  // City targets cascade via their plan FK.
  await db()
    .delete(schema.monthlyPlans)
    .where(eq(schema.monthlyPlans.id, planId));

  revalidatePath("/planner");
  return { ok: true };
}

/** Duplicates a saved plan (with its city goals) as "<name> (copy)". */
export async function duplicatePlan(
  workspaceId: string,
  planId: string,
): Promise<{ ok: boolean; planId?: string; error?: string }> {
  if (!(await canManageWorkspace(workspaceId))) {
    return { ok: false, error: "You don't have permission to edit this plan." };
  }
  const source = await findPlan(workspaceId, planId);
  if (!source) {
    return { ok: false, error: "Plan not found." };
  }

  const inserted = await db()
    .insert(schema.monthlyPlans)
    .values({
      workspaceId,
      name: `${source.name} (copy)`,
      month: source.month,
      periodStart: source.periodStart,
      periodEnd: source.periodEnd,
      budget: source.budget,
      targetCpl: source.targetCpl,
      conversionRate: source.conversionRate,
      targetLeads: source.targetLeads,
      targetSales: source.targetSales,
      notes: source.notes,
    })
    .returning({ id: schema.monthlyPlans.id });
  const copyId = inserted[0].id;

  const targets = await db()
    .select()
    .from(schema.planCityTargets)
    .where(eq(schema.planCityTargets.planId, planId));
  if (targets.length) {
    await db()
      .insert(schema.planCityTargets)
      .values(
        targets.map((t) => ({
          workspaceId,
          planId: copyId,
          month: t.month,
          cityName: t.cityName,
          region: t.region,
          targetResults: t.targetResults,
        })),
      );
  }

  revalidatePath("/planner");
  return { ok: true, planId: copyId };
}

/**
 * Type-ahead city search for the planner's add-city picker, backed by Meta's
 * geo targeting database so names match synced ad sets exactly. `state` is a
 * full state name (e.g. "Florida") to narrow the results.
 */
export async function searchPlanCities(
  workspaceId: string,
  q: string,
  state?: string | null,
): Promise<{ ok: boolean; cities?: GeoCitySuggestion[]; error?: string }> {
  if (!(await canManageWorkspace(workspaceId))) {
    return { ok: false, error: "You don't have permission to edit this plan." };
  }
  const query = q.trim();
  if (query.length < 2) return { ok: true, cities: [] };

  // The workspace's Meta connection token, else the agency-level token.
  const [conn] = await db()
    .select({ accessTokenEnc: schema.connections.accessTokenEnc })
    .from(schema.connections)
    .where(
      and(
        eq(schema.connections.workspaceId, workspaceId),
        eq(schema.connections.platform, "meta"),
        eq(schema.connections.status, "active"),
      ),
    )
    .limit(1);
  const token = conn?.accessTokenEnc
    ? decryptSecret(conn.accessTokenEnc)
    : await getSecret("meta_access_token");
  if (!token) {
    return { ok: false, error: "Meta is not connected — type the city manually." };
  }

  try {
    const all = await searchGeoCities(token, query);
    const cities = state
      ? all.filter((c) => c.region?.toLowerCase() === state.toLowerCase())
      : all;
    return { ok: true, cities: cities.slice(0, 10) };
  } catch {
    return { ok: false, error: "City search failed — type the city manually." };
  }
}
