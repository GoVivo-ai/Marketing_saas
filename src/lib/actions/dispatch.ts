"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { canManageWorkspace } from "@/lib/permissions";
import { getGraphConfig, getSiteId } from "@/lib/integrations/ms-graph";

export interface DispatchConnState {
  error?: string;
  success?: string;
}

/**
 * Saves (or updates) the workspace's Microsoft Graph connection. The secret
 * is optional on update — leaving it blank keeps the stored one. Credentials
 * are validated against Graph before persisting, so a typo never replaces a
 * working connection.
 */
export async function saveDispatchConnection(
  _prev: DispatchConnState,
  formData: FormData,
): Promise<DispatchConnState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  if (!workspaceId || !(await canManageWorkspace(workspaceId)))
    return { error: "You don't have permission to manage this workspace." };

  const tenantId = String(formData.get("tenantId") ?? "").trim();
  const clientId = String(formData.get("clientId") ?? "").trim();
  const clientSecret = String(formData.get("clientSecret") ?? "").trim();
  const siteUrl = String(formData.get("siteUrl") ?? "").trim();
  const listName = String(formData.get("listName") ?? "").trim();

  if (!tenantId || !clientId || !siteUrl || !listName)
    return { error: "Tenant ID, Client ID, site URL and list are required." };
  try {
    new URL(siteUrl);
  } catch {
    return { error: "The site URL isn't a valid URL." };
  }

  const [existing] = await db()
    .select({
      id: schema.dispatchConnections.id,
      clientSecretEnc: schema.dispatchConnections.clientSecretEnc,
    })
    .from(schema.dispatchConnections)
    .where(eq(schema.dispatchConnections.workspaceId, workspaceId))
    .limit(1);
  if (!clientSecret && !existing)
    return { error: "The client secret is required for a new connection." };

  const clientSecretEnc = clientSecret
    ? encryptSecret(clientSecret)
    : existing!.clientSecretEnc;

  // Probe Graph with the candidate credentials before saving anything.
  try {
    const { decryptSecret } = await import("@/lib/crypto");
    await getSiteId({
      tenantId,
      clientId,
      clientSecret: clientSecret || decryptSecret(clientSecretEnc),
      siteUrl,
      listName,
    });
  } catch (err) {
    return {
      error: `Connection test failed — nothing saved. ${err instanceof Error ? err.message.slice(0, 300) : ""}`,
    };
  }

  if (existing) {
    await db()
      .update(schema.dispatchConnections)
      .set({ tenantId, clientId, clientSecretEnc, siteUrl, listName, updatedAt: new Date() })
      .where(eq(schema.dispatchConnections.id, existing.id));
  } else {
    await db().insert(schema.dispatchConnections).values({
      workspaceId,
      tenantId,
      clientId,
      clientSecretEnc,
      siteUrl,
      listName,
    });
  }
  revalidatePath("/settings");
  return { success: "Microsoft connection verified and saved." };
}

/** Removes the workspace's Microsoft connection (synced data stays). */
export async function deleteDispatchConnection(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  if (!workspaceId || !(await canManageWorkspace(workspaceId)))
    throw new Error("You don't have permission to manage this workspace.");
  await db()
    .delete(schema.dispatchConnections)
    .where(eq(schema.dispatchConnections.workspaceId, workspaceId));
  revalidatePath("/settings");
}

/** Round-trip test of the stored connection: token + site lookup. */
export async function testDispatchConnection(
  workspaceId: string,
): Promise<{ ok: boolean; message: string }> {
  if (!(await canManageWorkspace(workspaceId)))
    return { ok: false, message: "No permission." };
  const cfg = await getGraphConfig(workspaceId);
  if (!cfg) return { ok: false, message: "No connection configured." };
  try {
    const siteId = await getSiteId(cfg);
    return { ok: true, message: `Connected — site ${siteId.split(",")[0]}.` };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message.slice(0, 300) : "Failed.",
    };
  }
}
