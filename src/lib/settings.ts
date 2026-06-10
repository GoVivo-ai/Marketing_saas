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

// ─────────────────────────────────────────────────────────────────────────
// Per-user RingCentral OAuth tokens — each user self-connects their own RC
// account to call/SMS leads. Tokens are AES-256-GCM encrypted at rest.
// ─────────────────────────────────────────────────────────────────────────

export interface RingCentralTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
  refreshExpiresAt: Date | null;
  fromNumber: string | null;
  ownerId: string | null;
}

export async function getRingCentralTokens(
  userId: string,
): Promise<RingCentralTokens | null> {
  if (!isDatabaseConfigured()) return null;
  const [row] = await db()
    .select({
      access: schema.users.rcAccessTokenEnc,
      refresh: schema.users.rcRefreshTokenEnc,
      expiresAt: schema.users.rcTokenExpiresAt,
      refreshExpiresAt: schema.users.rcRefreshTokenExpiresAt,
      fromNumber: schema.users.rcFromNumber,
      ownerId: schema.users.rcOwnerId,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!row?.access || !row.refresh) return null;
  return {
    accessToken: decryptSecret(row.access),
    refreshToken: decryptSecret(row.refresh),
    expiresAt: row.expiresAt,
    refreshExpiresAt: row.refreshExpiresAt,
    fromNumber: row.fromNumber,
    ownerId: row.ownerId,
  };
}

export interface RingCentralTokenUpdate {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  refreshExpiresInSec: number;
}

/** Full connect: stores tokens + the user's "from" number, stamps connectedAt. */
export async function setRingCentralTokens(
  userId: string,
  input: RingCentralTokenUpdate & { fromNumber: string | null; ownerId: string | null },
): Promise<void> {
  const now = Date.now();
  await db()
    .update(schema.users)
    .set({
      rcAccessTokenEnc: encryptSecret(input.accessToken),
      rcRefreshTokenEnc: encryptSecret(input.refreshToken),
      rcTokenExpiresAt: new Date(now + input.expiresInSec * 1000),
      rcRefreshTokenExpiresAt: new Date(now + input.refreshExpiresInSec * 1000),
      rcFromNumber: input.fromNumber,
      rcOwnerId: input.ownerId,
      rcConnectedAt: new Date(now),
    })
    .where(eq(schema.users.id, userId));
}

/** Refresh path: rotates tokens only, keeps fromNumber/ownerId/connectedAt. */
export async function updateRingCentralAccessToken(
  userId: string,
  input: RingCentralTokenUpdate,
): Promise<void> {
  const now = Date.now();
  await db()
    .update(schema.users)
    .set({
      rcAccessTokenEnc: encryptSecret(input.accessToken),
      rcRefreshTokenEnc: encryptSecret(input.refreshToken),
      rcTokenExpiresAt: new Date(now + input.expiresInSec * 1000),
      rcRefreshTokenExpiresAt: new Date(now + input.refreshExpiresInSec * 1000),
    })
    .where(eq(schema.users.id, userId));
}

export async function clearRingCentralTokens(userId: string): Promise<void> {
  await db()
    .update(schema.users)
    .set({
      rcAccessTokenEnc: null,
      rcRefreshTokenEnc: null,
      rcTokenExpiresAt: null,
      rcRefreshTokenExpiresAt: null,
      rcFromNumber: null,
      rcOwnerId: null,
      rcConnectedAt: null,
    })
    .where(eq(schema.users.id, userId));
}

export async function isRingCentralConnected(userId: string): Promise<boolean> {
  const tokens = await getRingCentralTokens(userId);
  if (!tokens) return false;
  // A dead refresh token means the connection can't be renewed.
  return !tokens.refreshExpiresAt || tokens.refreshExpiresAt.getTime() > Date.now();
}
