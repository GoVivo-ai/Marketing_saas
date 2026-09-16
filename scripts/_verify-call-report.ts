/** Compares the Daily Calls report for Juliana on 2026-09-03 with Juancho's CSV. */
process.loadEnvFile(".env.local");
import { getDailyCallReport } from "../src/lib/call-report";
async function main() {
  const { db, schema } = await import("../src/lib/db");
  const { eq } = await import("drizzle-orm");
  const [ws] = await db().select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.slug, "alexyah"));
  const rep = await getDailyCallReport(ws.id, { start: new Date("2026-09-02T00:00:00Z"), end: new Date("2026-09-05T00:00:00Z") });
  for (const r of rep.rows.filter((r) => r.day === "2026-09-03")) {
    const { gaps, redials, longCalls, ...kpi } = r;
    console.log(kpi);
    console.log(" gaps", gaps.map((g) => `${g.minutes}m/${g.level}`).join(", "));
    console.log(" redials", redials.map((d) => `${d.number} x${d.attempts.length} in ${d.windowMin}m`).join(", "));
    console.log(" long", longCalls.map((c) => `${c.leadName ?? c.number} ${c.durationSec}s`).join(", "));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
