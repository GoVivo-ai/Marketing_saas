process.loadEnvFile(".env.local");

import { and, isNull, gte, sql, eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { getSecret } from "../src/lib/settings";
import { scoringModel } from "../src/lib/ai/provider";

async function main() {
  const openaiKey = await getSecret("openai_api_key");
  console.log("openai_api_key configurada:", openaiKey ? `sí (…${openaiKey.slice(-4)})` : "NO");
  const model = await scoringModel();
  console.log("modelo de scoring:", model?.label ?? "ninguno");

  const rows = await db()
    .select({
      ws: schema.workspaces.name,
      total: sql<number>`count(*)`,
      sinScore: sql<number>`count(*) filter (where ${schema.leads.aiScore} is null)`,
      ultimos7dSinScore: sql<number>`count(*) filter (where ${schema.leads.aiScore} is null and ${schema.leads.createdAt} > now() - interval '7 days')`,
      maxCreated: sql<string>`max(${schema.leads.createdAt})`,
    })
    .from(schema.leads)
    .innerJoin(schema.workspaces, eq(schema.leads.workspaceId, schema.workspaces.id))
    .groupBy(schema.workspaces.name);
  console.table(rows);

  const recent = await db()
    .select({
      id: schema.leads.id,
      name: schema.leads.name,
      ws: schema.workspaces.name,
      created: schema.leads.createdAt,
      reason: schema.leads.aiScoreReason,
    })
    .from(schema.leads)
    .innerJoin(schema.workspaces, eq(schema.leads.workspaceId, schema.workspaces.id))
    .where(isNull(schema.leads.aiScore))
    .orderBy(sql`${schema.leads.createdAt} desc`)
    .limit(10);
  console.log("Últimos 10 sin score:");
  console.table(recent);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
