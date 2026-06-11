/**
 * One-off backfill: scores every lead that still has no AI score, across all
 * workspaces, until none remain. Run: npx tsx scripts/score-pending.ts
 */
process.loadEnvFile(".env.local");

import { db, schema } from "../src/lib/db";
import { scorePendingLeads } from "../src/lib/ai/lead-scoring";

async function main() {
  const workspaces = await db()
    .select({ id: schema.workspaces.id, name: schema.workspaces.name })
    .from(schema.workspaces);

  for (const ws of workspaces) {
    let pass = 0;
    for (;;) {
      const { scored, remaining } = await scorePendingLeads(ws.id, 50);
      pass++;
      console.log(`[${ws.name}] pass ${pass}: scored ${scored}, remaining ${remaining}`);
      if (scored === 0 || remaining === 0) break;
    }
  }
  console.log("Done.");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
