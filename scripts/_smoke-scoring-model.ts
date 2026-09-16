/** Verifica qué modelo resuelve el scoring y prueba un chunk de 2 leads. */
process.loadEnvFile(".env.local");
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { scoringModel } from "../src/lib/ai/provider";
import { scorePendingLeads } from "../src/lib/ai/lead-scoring";

const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63";
async function main() {
  const resolved = await scoringModel(WS);
  console.log("Modelo de scoring:", resolved?.label ?? "NINGUNO (sin keys)");
  if (process.argv.includes("--run")) {
    const r = await scorePendingLeads(WS, 4);
    console.log("scorePendingLeads(4):", r);
    const sample = await db().select({ name: schema.leads.name, score: schema.leads.aiScore, reason: schema.leads.aiScoreReason })
      .from(schema.leads)
      .where(and(eq(schema.leads.workspaceId, WS)))
      .orderBy(schema.leads.updatedAt).limit(0);
    void sample; void isNull;
  }
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});
