"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { syncConnection } from "@/lib/sync";
import { getSecret } from "@/lib/settings";

async function requireAgencyUser() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "agency_admin" && role !== "agency_member")) {
    throw new Error("Only agency users can manage connections");
  }
  return session;
}

/**
 * Links a Meta ad account (visible to the agency system-user token) to a
 * workspace and runs an initial 30-day sync.
 */
export async function connectMetaAccount(formData: FormData) {
  await requireAgencyUser();

  const accountId = String(formData.get("accountId") ?? "");
  const accountName = String(formData.get("accountName") ?? "") || null;
  const workspaceId = String(formData.get("workspaceId") ?? "");
  if (!accountId.startsWith("act_") || !workspaceId) {
    throw new Error("Missing account or workspace");
  }

  const token = await getSecret("meta_access_token");
  if (!token) {
    throw new Error("Meta token is not configured (Settings → Connections)");
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
  await requireAgencyUser();
  const connectionId = String(formData.get("connectionId") ?? "");
  if (!connectionId) throw new Error("Missing connection");
  await syncConnection(connectionId, { days: 30 });
  revalidatePath("/settings");
}

/** Marks a connection as disconnected (data is kept). */
export async function disconnectConnection(formData: FormData) {
  await requireAgencyUser();
  const connectionId = String(formData.get("connectionId") ?? "");
  if (!connectionId) throw new Error("Missing connection");
  await db()
    .update(schema.connections)
    .set({ status: "disconnected" })
    .where(eq(schema.connections.id, connectionId));
  revalidatePath("/settings");
}
