import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

const MODEL = "claude-sonnet-4-6";

const variantsSchema = z.object({
  variants: z
    .array(
      z.object({
        headline: z.string().max(60),
        primaryText: z.string().max(300),
        cta: z.string().max(25),
        angle: z.string().describe("The persuasion angle used, e.g. 'social proof'"),
      }),
    )
    .length(3),
});

export type AdCopyVariant = z.infer<typeof variantsSchema>["variants"][number];

/**
 * Generates ad copy variants seeded with the account's actual winning ads,
 * so new creative iterates on what is already proven to convert for this
 * specific client instead of generic templates.
 */
export async function generateAdVariants(input: {
  workspaceName: string;
  product: string;
  audience: string;
  language?: "en" | "es";
  winningAds?: { text: string; cpl: number }[];
}): Promise<AdCopyVariant[]> {
  const lang = input.language === "es" ? "Spanish" : "English";
  const { object } = await generateObject({
    model: anthropic(MODEL),
    schema: variantsSchema,
    prompt: [
      `You write direct-response ad copy for Meta campaigns. Output language: ${lang}.`,
      `Client: ${input.workspaceName}. Product/offer: ${input.product}.`,
      `Target audience: ${input.audience}.`,
      input.winningAds?.length
        ? `These ads are currently winning for this account (lower CPL = better). ` +
          `Iterate on their hooks and tone, don't copy them verbatim:\n` +
          JSON.stringify(input.winningAds, null, 2)
        : `No historical winners available — use proven direct-response frameworks.`,
      `Produce exactly 3 variants with clearly different persuasion angles.`,
    ].join("\n"),
  });
  return object.variants;
}
