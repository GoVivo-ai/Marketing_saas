process.loadEnvFile(".env.local");
import { syncConnection } from "../src/lib/sync";
async function main() {
  const FTS_CONN = "5550d086-cd55-40e7-bd7c-11de48a79ce6";
  console.log("Relink retry (45-day window) at", new Date().toISOString());
  const stats = await syncConnection(FTS_CONN, { days: 45 });
  console.log("Sync stats:", stats);
  process.exit(0);
}
main().catch((e) => { console.error("SYNC FAILED:", e); process.exit(1); });
