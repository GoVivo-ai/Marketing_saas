import { eq } from "drizzle-orm";
import { db, schema, isDatabaseConfigured } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

/**
 * Agency-level secrets managed from the platform UI (Settings → Connections).
 * Stored encrypted in app_settings; environment variables act only as a
 * local-development fallback.
 */

export type SecretKey = "meta_access_token" | "anthropic_api_key";

const ENV_FALLBACK: Record<SecretKey, () => string | undefined> = {
  meta_access_token: () => process.env.META_ACCESS_TOKEN,
  anthropic_api_key: () => process.env.ANTHROPIC_API_KEY,
};

export async function getSecret(key: SecretKey): Promise<string | null> {
  if (isDatabaseConfigured()) {
    const [row] = await db()
      .select({ valueEnc: schema.appSettings.valueEnc })
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, key))
      .limit(1);
    if (row) return decryptSecret(row.valueEnc);
  }
  return ENV_FALLBACK[key]() ?? null;
}

export async function setSecret(key: SecretKey, value: string): Promise<void> {
  const valueEnc = encryptSecret(value.trim());
  await db()
    .insert(schema.appSettings)
    .values({ key, valueEnc, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { valueEnc, updatedAt: new Date() },
    });
}

/** Masked preview for the UI, e.g. "••••••Fk2a" — never the full value. */
export async function getSecretPreview(key: SecretKey): Promise<string | null> {
  const value = await getSecret(key);
  if (!value) return null;
  return `••••••${value.slice(-4)}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Per-client Meta token — each workspace (client) has its own system-user
// token, used to list and sync only that client's ad accounts.
// ─────────────────────────────────────────────────────────────────────────

export async function getWorkspaceMetaToken(
  workspaceId: string,
): Promise<string | null> {
  if (!isDatabaseConfigured()) return process.env.META_ACCESS_TOKEN ?? null;
  const [row] = await db()
    .select({ enc: schema.workspaces.metaAccessTokenEnc })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  return row?.enc ? decryptSecret(row.enc) : null;
}

export async function setWorkspaceMetaToken(
  workspaceId: string,
  value: string,
): Promise<void> {
  await db()
    .update(schema.workspaces)
    .set({ metaAccessTokenEnc: encryptSecret(value.trim()) })
    .where(eq(schema.workspaces.id, workspaceId));
}

export async function getWorkspaceMetaTokenPreview(
  workspaceId: string,
): Promise<string | null> {
  const value = await getWorkspaceMetaToken(workspaceId);
  return value ? `••••••${value.slice(-4)}` : null;
}
