process.loadEnvFile(".env.local");
import { metaConnector } from "../src/lib/integrations/meta";

async function main() {
  const creds = { accessToken: process.env.META_ACCESS_TOKEN!, accountId: "" };
  const accounts = await metaConnector.listAccounts(creds);
  console.log("ACCOUNTS:", JSON.stringify(accounts, null, 2));

  for (const acc of accounts) {
    const c = { ...creds, accountId: acc.externalId };
    const campaigns = await metaConnector.listCampaigns(c);
    console.log(`\n${acc.name} (${acc.externalId}) — ${campaigns.length} campaigns`);
    for (const camp of campaigns.slice(0, 5)) {
      console.log(`  · ${camp.name} [${camp.status}] ${camp.objective ?? ""}`);
    }
    const metrics = await metaConnector.fetchDailyMetrics(c, {
      since: "2026-06-03",
      until: "2026-06-09",
    });
    const spend = metrics.reduce((s, m) => s + m.spend, 0);
    const leads = metrics.reduce((s, m) => s + m.leads, 0);
    console.log(`  last 7 days: ${metrics.length} rows, spend=${spend.toFixed(2)}, leads=${leads}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
