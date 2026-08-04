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
import { isGraphConfigured, readListItems } from "../src/lib/integrations/ms-graph";
import { syncDispatchInteractions } from "../src/lib/dispatch-sync";

const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63"; // AlexYah

async function main() {
  if (!isGraphConfigured()) {
    console.error(
      "Graph not configured — set MS_TENANT_ID, MS_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, SHAREPOINT_SITE_URL",
    );
    process.exit(1);
  }
  if (process.argv.includes("--inspect")) {
    const listName = process.env.SHAREPOINT_LIST_NAME ?? "Alexyah's Interactions";
    const items = await readListItems(listName);
    console.log(`list "${listName}": ${items.length} items`);
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
