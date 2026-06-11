import { generateObject } from "ai";
import { z } from "zod";
import { anthropicProvider } from "./provider";

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
