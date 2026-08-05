/**
 * SharePoint → dispatch_interactions sync (upsert by sp_item_id; SharePoint
 * stays the system of record). Shared by the cron route and the manual
 * script (scripts/sync-dispatch-interactions.ts).
 */
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  getGraphConfig,
  readListItems,
  type SpListItem,
} from "@/lib/integrations/ms-graph";

/**
 * First matching field key wins. Verified against the live list: Title =
 * driver name, Typology = the old export's "Category", creationDate = the
 * business creation date (vs. the item's createdDateTime).
 */
const FIELD_CANDIDATES: Record<string, string[]> = {
  driverName: ["Title", "Driver_x0020_Name", "DriverName"],
  priority: ["Priority"],
  status: ["Status"],
  description: ["Description", "Body"],
  classification: ["Clasification", "Classification"],
  category: ["Typology", "Category"],
  subCategories: ["Sub_x002d_Category", "SubCategory", "Sub_Category"],
  resolvedAt: ["ResolutionDate", "Resolution_x0020_Date"],
  createdAtBiz: ["creationDate"],
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
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export interface DispatchSyncResult {
  items: number;
  upserts: number;
}

/** Pulls the workspace's SharePoint list and upserts it. */
export async function syncDispatchInteractions(
  workspaceId: string,
): Promise<DispatchSyncResult> {
  const cfg = await getGraphConfig(workspaceId);
  if (!cfg) throw new Error("No Microsoft connection configured for this workspace");
  const items: SpListItem[] = await readListItems(cfg);

  const drivers = await db()
    .select({
      id: schema.dispatchDrivers.id,
      normName: schema.dispatchDrivers.normName,
    })
    .from(schema.dispatchDrivers)
    .where(eq(schema.dispatchDrivers.workspaceId, workspaceId));
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
      workspaceId,
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
      spCreatedAt: pick(f, "createdAtBiz")
        ? new Date(String(pick(f, "createdAtBiz")))
        : item.createdDateTime
          ? new Date(item.createdDateTime)
          : null,
      spModifiedAt: item.lastModifiedDateTime
        ? new Date(item.lastModifiedDateTime)
        : null,
      resolvedAt: pick(f, "resolvedAt")
        ? new Date(String(pick(f, "resolvedAt")))
        : null,
    };
    await db()
      .insert(schema.dispatchInteractions)
      .values(values)
      .onConflictDoUpdate({
        target: [
          schema.dispatchInteractions.workspaceId,
          schema.dispatchInteractions.spItemId,
        ],
        set: { ...values, workspaceId: undefined, spItemId: undefined } as never,
      });
    upserts++;
  }

  // Rows without an sp_item_id are legacy CSV imports superseded by the live
  // list — clear them once real items have landed.
  if (upserts > 0) {
    await db()
      .delete(schema.dispatchInteractions)
      .where(
        and(
          eq(schema.dispatchInteractions.workspaceId, workspaceId),
          sql`${schema.dispatchInteractions.spItemId} IS NULL`,
        ),
      );
  }
  await db()
    .update(schema.dispatchConnections)
    .set({ lastSyncedAt: new Date() })
    .where(eq(schema.dispatchConnections.workspaceId, workspaceId));
  return { items: items.length, upserts };
}

/** Every workspace with a Microsoft connection, for the cron fan-out. */
export async function connectedDispatchWorkspaces(): Promise<string[]> {
  const rows = await db()
    .select({ workspaceId: schema.dispatchConnections.workspaceId })
    .from(schema.dispatchConnections);
  return rows.map((r) => r.workspaceId);
}
