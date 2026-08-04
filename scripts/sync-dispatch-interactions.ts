/**
 * Syncs the SharePoint "Driver Incidents Report" list into
 * dispatch_interactions (upsert by sp_item_id; SharePoint stays the system of
 * record). Run manually or from cron once Graph credentials are configured:
 *
 *   npx tsx scripts/sync-dispatch-interactions.ts            # sync
 *   npx tsx scripts/sync-dispatch-interactions.ts --inspect  # print field names
 *
 * ONE-TIME SITE GRANT (Sites.Selected sees nothing until this): an admin
 * (Alirio) opens https://developer.microsoft.com/graph/graph-explorer signed
 * in as admin and runs
 *
 *   POST https://graph.microsoft.com/v1.0/sites/{site-id}/permissions
 *   { "roles": ["write"],
 *     "grantedToIdentities": [{ "application": {
 *       "id": "<MS_CLIENT_ID>", "displayName": "Vivo Martech - Dispatch" } }] }
 *
 * (site-id via GET /sites/{hostname}:/sites/{path} with his session.)
 */
process.loadEnvFile(".env.local");
import { eq, and, sql } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import {
  isGraphConfigured,
  readListItems,
  type SpListItem,
} from "../src/lib/integrations/ms-graph";

const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63"; // AlexYah
const LIST_NAME = process.env.SHAREPOINT_LIST_NAME ?? "Alexyah's Interactions";

/** First matching field key wins — SharePoint munges display names. */
const FIELD_CANDIDATES: Record<string, string[]> = {
  driverName: ["Driver_x0020_Name", "Driver_x0027_s_x0020_Name", "DriverName", "Title"],
  priority: ["Priority"],
  status: ["Status"],
  description: ["Description", "Body"],
  classification: ["Clasification", "Classification"],
  category: ["Category"],
  subCategories: ["Sub_x002d_Category", "SubCategory", "Sub_Category"],
  assignedTo: ["Assigned_x0020_toLookupId", "Assigned_x0020_to", "AssignedTo"],
  resolvedAt: ["Resolution_x0020_Date", "ResolutionDate"],
};

function pick(fields: Record<string, unknown>, key: keyof typeof FIELD_CANDIDATES) {
  for (const k of FIELD_CANDIDATES[key]) {
    if (fields[k] != null && fields[k] !== "") return fields[k];
  }
  return null;
}

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, "\n")
    .replace(/<li>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#160;|&nbsp;/g, " ")
    .replace(/&#58;/g, ":")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeName(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
}

async function main() {
  if (!isGraphConfigured()) {
    console.error(
      "Graph not configured — set MS_TENANT_ID, MS_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, SHAREPOINT_SITE_URL",
    );
    process.exit(1);
  }
  const items: SpListItem[] = await readListItems(LIST_NAME);
  console.log(`SharePoint list "${LIST_NAME}": ${items.length} items`);

  if (process.argv.includes("--inspect")) {
    console.log("field keys of first item:", Object.keys(items[0]?.fields ?? {}));
    console.log(JSON.stringify(items[0], null, 2).slice(0, 3000));
    process.exit(0);
  }

  const drivers = await db()
    .select({ id: schema.dispatchDrivers.id, normName: schema.dispatchDrivers.normName })
    .from(schema.dispatchDrivers)
    .where(eq(schema.dispatchDrivers.workspaceId, WS));
  const byName = new Map(drivers.map((d) => [d.normName, d.id]));

  let upserts = 0;
  for (const item of items) {
    const f = item.fields;
    const driverName = (pick(f, "driverName") as string | null)?.trim() || null;
    const rawSub = pick(f, "subCategories");
    let subCategories: string[] | null = null;
    if (Array.isArray(rawSub)) subCategories = rawSub.map(String);
    else if (typeof rawSub === "string") {
      try {
        const parsed = JSON.parse(rawSub);
        subCategories = Array.isArray(parsed) ? parsed.map(String) : [rawSub];
      } catch {
        subCategories = [rawSub];
      }
    }
    const description = pick(f, "description");
    const values = {
      workspaceId: WS,
      spItemId: item.id,
      driverId: driverName ? (byName.get(normalizeName(driverName)) ?? null) : null,
      driverName,
      priority: (pick(f, "priority") as string | null) ?? null,
      status: (pick(f, "status") as string | null) ?? null,
      description: typeof description === "string" ? stripHtml(description) : null,
      classification: (pick(f, "classification") as string | null) ?? null,
      category: (pick(f, "category") as string | null) ?? null,
      subCategories,
      createdBy: item.createdBy?.user?.displayName ?? null,
      modifiedBy: item.lastModifiedBy?.user?.displayName ?? null,
      spCreatedAt: item.createdDateTime ? new Date(item.createdDateTime) : null,
      spModifiedAt: item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : null,
      resolvedAt: pick(f, "resolvedAt") ? new Date(String(pick(f, "resolvedAt"))) : null,
    };
    await db()
      .insert(schema.dispatchInteractions)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.dispatchInteractions.workspaceId, schema.dispatchInteractions.spItemId],
        set: { ...values, workspaceId: undefined, spItemId: undefined } as never,
      });
    upserts++;
  }

  // CSV-imported rows (sp_item_id IS NULL) duplicate what Graph now owns —
  // drop them once the live sync has landed real items.
  if (upserts > 0) {
    const removed = await db()
      .delete(schema.dispatchInteractions)
      .where(
        and(
          eq(schema.dispatchInteractions.workspaceId, WS),
          sql`${schema.dispatchInteractions.spItemId} IS NULL`,
        ),
      );
    console.log("synced:", upserts, "| legacy CSV rows removed:", removed);
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
