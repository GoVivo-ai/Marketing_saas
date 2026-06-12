import { generateObject } from "ai";
import { z } from "zod";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { radiusBoost } from "@/lib/geo";
import { anthropicProvider, isAiConfigured } from "./provider";

const MODEL = "claude-haiku-4-5-20251001"; // high volume, low latency — cheap model

const scoreSchema = z.object({
  score: z.number().min(0).max(100),
  reason: z.string().describe("One sentence explaining the score"),
  suggestedAction: z
    .string()
    .describe("Concrete next step for the sales team, e.g. 'Call within 1 hour'"),
});

export type LeadScore = z.infer<typeof scoreSchema>;

/**
 * Scores an incoming lead 0-100 based on its form answers and the
 * workspace's qualification criteria. Runs on every new lead at sync time
 * so the unified inbox is always pre-prioritized for the operations team.
 */
export async function scoreLead(input: {
  workspaceId?: string;
  workspaceName: string;
  industry?: string;
  qualificationCriteria?: string;
  formData: Record<string, unknown>;
}): Promise<LeadScore> {
  const anthropic = await anthropicProvider(input.workspaceId);
  const { object } = await generateObject({
    model: anthropic(MODEL),
    schema: scoreSchema,
    prompt: [
      `Score this inbound marketing lead from 0 (junk) to 100 (ready to buy).`,
      `Business: ${input.workspaceName}${input.industry ? ` (${input.industry})` : ""}.`,
      input.qualificationCriteria
        ? `Qualification criteria defined by the client: ${input.qualificationCriteria}`
        : `No explicit criteria — judge by completeness, intent signals and contact quality.`,
      ``,
      `Lead form answers:`,
      JSON.stringify(input.formData, null, 2),
    ].join("\n"),
  });
  return object;
}

/**
 * Radius boost per lead: leads inside their ad set's audience radius score
 * higher (in-radius leads convert better — they live where the service
 * operates). Returns a map of leadId → boost points (0/5/10).
 */
export async function radiusBoostByLeadId(
  leadIds: string[],
): Promise<Map<string, number>> {
  if (!leadIds.length) return new Map();
  const rows = await db()
    .select({
      id: schema.leads.id,
      geoLat: schema.leads.geoLat,
      geoLng: schema.leads.geoLng,
      targetLat: schema.adsets.lat,
      targetLng: schema.adsets.lng,
      targetRadius: schema.adsets.radius,
      targetUnit: schema.adsets.distanceUnit,
    })
    .from(schema.leads)
    .leftJoin(schema.adsets, eq(schema.leads.adsetId, schema.adsets.id))
    .where(inArray(schema.leads.id, leadIds));
  return new Map(rows.map((r) => [r.id, radiusBoost(r)]));
}

/** Final score = AI base + radius boost, capped at 100 (with the boost actually applied). */
export function withRadiusBoost(
  base: number,
  boost: number,
): { score: number; applied: number } {
  const score = Math.min(100, Math.round(base) + boost);
  return { score, applied: score - Math.round(base) };
}

/**
 * Scores leads in a workspace that don't have a score yet (null aiScore).
 * Used to drain the backlog and retry leads that failed scoring at sync time,
 * so every lead eventually gets a score. Returns how many were scored.
 */
export async function scorePendingLeads(
  workspaceId: string,
  limit = 100,
): Promise<{ scored: number; remaining: number }> {
  if (!(await isAiConfigured(workspaceId))) return { scored: 0, remaining: 0 };

  const [ws] = await db()
    .select({
      name: schema.workspaces.name,
      industry: schema.workspaces.industry,
      qualificationCriteria: schema.workspaces.qualificationCriteria,
    })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  if (!ws) return { scored: 0, remaining: 0 };

  const pending = await db()
    .select({ id: schema.leads.id, formData: schema.leads.formData })
    .from(schema.leads)
    .where(
      and(
        eq(schema.leads.workspaceId, workspaceId),
        isNull(schema.leads.aiScore),
      ),
    )
    .limit(limit);

  const boosts = await radiusBoostByLeadId(pending.map((l) => l.id));

  let scored = 0;
  for (const lead of pending) {
    try {
      const r = await scoreLead({
        workspaceId,
        workspaceName: ws.name,
        industry: ws.industry ?? undefined,
        qualificationCriteria: ws.qualificationCriteria ?? undefined,
        formData: (lead.formData ?? {}) as Record<string, unknown>,
      });
      const { score, applied } = withRadiusBoost(r.score, boosts.get(lead.id) ?? 0);
      await db()
        .update(schema.leads)
        .set({
          aiScore: score,
          radiusBoost: applied,
          aiScoreReason: r.reason,
          aiSuggestedAction: r.suggestedAction,
        })
        .where(eq(schema.leads.id, lead.id));
      scored++;
    } catch {
      // Transient failure — left pending, retried on the next run.
    }
  }

  const [{ remaining }] = await db()
    .select({ remaining: sql<number>`count(*)::int` })
    .from(schema.leads)
    .where(
      and(
        eq(schema.leads.workspaceId, workspaceId),
        isNull(schema.leads.aiScore),
      ),
    );
  return { scored, remaining: Number(remaining) };
}
