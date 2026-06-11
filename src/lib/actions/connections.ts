"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { syncConnection } from "@/lib/sync";
import {
  getWorkspaceMetaToken,
  setWorkspaceMetaToken,
  setWorkspaceAnthropicKey,
} from "@/lib/settings";
import { canManageWorkspace } from "@/lib/permissions";

/** The agency team or the workspace owner may manage a workspace's connections. */
async function requireWorkspaceManager(workspaceId: string) {
  if (!workspaceId) throw new Error("Missing workspace");
  if (!(await canManageWorkspace(workspaceId))) {
    throw new Error("You don't have permission to manage this workspace");
  }
}

/** Resolves a connection's workspace, then checks management permission. */
async function requireConnectionManager(connectionId: string) {
  if (!connectionId) throw new Error("Missing connection");
  const [conn] = await db()
    .select({ workspaceId: schema.connections.workspaceId })
    .from(schema.connections)
    .where(eq(schema.connections.id, connectionId))
    .limit(1);
  if (!conn) throw new Error("Connection not found");
  await requireWorkspaceManager(conn.workspaceId);
}

/**
 * Links a Meta ad account (visible to the agency system-user token) to a
 * workspace and runs an initial 30-day sync.
 */
export async function connectMetaAccount(formData: FormData) {
  const accountId = String(formData.get("accountId") ?? "");
  const accountName = String(formData.get("accountName") ?? "") || null;
  const workspaceId = String(formData.get("workspaceId") ?? "");
  if (!accountId.startsWith("act_") || !workspaceId) {
    throw new Error("Missing account or workspace");
  }
  await requireWorkspaceManager(workspaceId);

  // Use this client's own Meta token (each workspace has its own).
  const token = await getWorkspaceMetaToken(workspaceId);
  if (!token) {
    throw new Error("This client has no Meta token yet (Settings → Connections)");
  }

  // One ad account belongs to exactly one client. Look at every row for this
  // account so we can (a) block linking it to a second client while it is
  // still active elsewhere, and (b) reuse this workspace's own row if present.
  const rows = await db()
    .select({
      id: schema.connections.id,
      workspaceId: schema.connections.workspaceId,
      status: schema.connections.status,
    })
    .from(schema.connections)
    .where(
      and(
        eq(schema.connections.platform, "meta"),
        eq(schema.connections.accountId, accountId),
      ),
    );

  const activeElsewhere = rows.find(
    (r) => r.status === "active" && r.workspaceId !== workspaceId,
  );
  if (activeElsewhere) {
    throw new Error(
      "This ad account is already linked to another client. Disconnect it there first.",
    );
  }

  // Re-connecting to the same workspace refreshes its token/status.
  const existing = rows.find((r) => r.workspaceId === workspaceId);

  let connectionId: string;
  if (existing) {
    await db()
      .update(schema.connections)
      .set({
        workspaceId,
        accountName,
        accessTokenEnc: encryptSecret(token),
        status: "active",
      })
      .where(eq(schema.connections.id, existing.id));
    connectionId = existing.id;
  } else {
    const [created] = await db()
      .insert(schema.connections)
      .values({
        workspaceId,
        platform: "meta",
        accountId,
        accountName,
        accessTokenEnc: encryptSecret(token),
      })
      .returning({ id: schema.connections.id });
    connectionId = created.id;
  }

  await syncConnection(connectionId, { days: 30 });
  revalidatePath("/settings");
}

/** Re-runs the sync for an existing connection (last 30 days). */
export async function syncConnectionNow(formData: FormData) {
  const connectionId = String(formData.get("connectionId") ?? "");
  await requireConnectionManager(connectionId);
  await syncConnection(connectionId, { days: 30 });
  revalidatePath("/settings");
}

/** Marks a connection as disconnected (data is kept). */
export async function disconnectConnection(formData: FormData) {
  const connectionId = String(formData.get("connectionId") ?? "");
  await requireConnectionManager(connectionId);
  await db()
    .update(schema.connections)
    .set({ status: "disconnected" })
    .where(eq(schema.connections.id, connectionId));
  revalidatePath("/settings");
}

/** Saves a client's own Meta system-user token (encrypted). */
export async function saveWorkspaceMetaToken(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const value = String(formData.get("value") ?? "").trim();
  await requireWorkspaceManager(workspaceId);
  if (!value) throw new Error("Token is required");
  await setWorkspaceMetaToken(workspaceId, value);
  revalidatePath("/settings");
}

/** Saves a client's own Anthropic (AI) API key (encrypted). */
export async function saveWorkspaceAiKey(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const value = String(formData.get("value") ?? "").trim();
  await requireWorkspaceManager(workspaceId);
  if (!value) throw new Error("API key is required");
  await setWorkspaceAnthropicKey(workspaceId, value);
  revalidatePath("/settings");
}
