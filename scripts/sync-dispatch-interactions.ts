/**
 * Manual runner for the SharePoint → dispatch_interactions sync (the daily
 * cron at /api/cron/dispatch-sync uses the same lib). Modes:
 *
 *   npx tsx scripts/sync-dispatch-interactions.ts            # sync
 *   npx tsx scripts/sync-dispatch-interactions.ts --inspect  # print field names
 *
 * ONE-TIME SITE GRANT (Sites.Selected sees nothing until this): an admin
 * opens https://developer.microsoft.com/graph/graph-explorer signed in as
 * admin and runs
 *
 *   POST https://graph.microsoft.com/v1.0/sites/{site-id}/permissions
 *   { "roles": ["write"],
 *     "grantedToIdentities": [{ "application": {
 *       "id": "<MS_CLIENT_ID>", "displayName": "Vivo Martech - Dispatch" } }] }
 */
process.loadEnvFile(".env.local");
import { getGraphConfig, readListItems } from "../src/lib/integrations/ms-graph";
import { syncDispatchInteractions } from "../src/lib/dispatch-sync";

const WS = process.argv.find((a) => a.startsWith("--ws="))?.slice(5) ??
  "3013ca8e-e48e-40d8-b707-8a1987bccc63"; // AlexYah by default

async function main() {
  const cfg = await getGraphConfig(WS);
  if (!cfg) {
    console.error("No Microsoft connection for workspace", WS);
    process.exit(1);
  }
  if (process.argv.includes("--inspect")) {
    const items = await readListItems(cfg);
    console.log(`list "${cfg.listName}": ${items.length} items`);
    console.log("field keys of first item:", Object.keys(items[0]?.fields ?? {}));
    console.log(JSON.stringify(items[0], null, 2).slice(0, 3000));
    process.exit(0);
  }
  const result = await syncDispatchInteractions(WS);
  console.log("synced:", result);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
