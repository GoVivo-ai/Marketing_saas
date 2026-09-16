/** Corre UN chunk de scoring con los errores a la vista (sin catch). */
process.loadEnvFile(".env.local");
import { and, eq, isNull } from "drizzle-orm";
import { generateObject } from "ai";
import { z } from "zod";
import { db, schema } from "../src/lib/db";
import { anthropicProvider, isAiConfigured } from "../src/lib/ai/provider";

const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63";
const MODEL = "claude-haiku-4-5-20251001";

async function main() {
  console.log("isAiConfigured:", await isAiConfigured(WS));
  const provider = await anthropicProvider(WS);
  const [lead] = await db()
    .select({ id: schema.leads.id, name: schema.leads.name, formData: schema.leads.formData })
    .from(schema.leads)
    .where(and(eq(schema.leads.workspaceId, WS), isNull(schema.leads.aiScore)))
    .limit(1);
  console.log("Lead de prueba:", lead.name);
  const { object } = await generateObject({
    model: provider(MODEL),
    schema: z.object({
      leads: z.array(z.object({
        index: z.number().int(),
        score: z.number().min(0).max(100),
        reason: z.string(),
        suggestedAction: z.string(),
      })),
    }),
    abortSignal: AbortSignal.timeout(60_000),
    prompt: `Score this 1 inbound marketing lead from 0 to 100. Return one entry with index 0.\n<lead_form_data index="0">${JSON.stringify(lead.formData)}</lead_form_data>`,
  });
  console.log("OK:", JSON.stringify(object));
  process.exit(0);
}
main().catch((e) => { console.error("FALLO:", e); process.exit(1); });
