import { eq } from "drizzle-orm";
import { db, schema, isDatabaseConfigured } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

/**
 * Agency-level secrets managed from the platform UI (Settings → Connections).
 * Stored encrypted in app_settings; environment variables act only as a
 * local-development fallback.
 */

export type SecretKey =
  | "meta_access_token"
  | "anthropic_api_key"
  | "openai_api_key";

const ENV_FALLBACK: Record<SecretKey, () => string | undefined> = {
  meta_access_token: () => process.env.META_ACCESS_TOKEN,
  anthropic_api_key: () => process.env.ANTHROPIC_API_KEY,
  openai_api_key: () => process.env.OPENAI_API_KEY,
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
// RingCentral environment — an agency-global switch (Production vs Sandbox).
// Production and Sandbox are *separate* RingCentral systems with their own
// Client ID/Secret, so the chosen mode selects which credential set + server
// URL the connector uses. Stored in app_settings; admins toggle it from the UI.
// ─────────────────────────────────────────────────────────────────────────

export type RingCentralEnv = "production" | "sandbox";
const RC_ENV_KEY = "ringcentral_environment";

/** Fallback when nothing is stored: infer from the configured server URL. */
function defaultRingCentralEnv(): RingCentralEnv {
  return process.env.RINGCENTRAL_SERVER_URL?.includes("devtest")
    ? "sandbox"
    : "production";
}

export async function getRingCentralEnv(): Promise<RingCentralEnv> {
  if (isDatabaseConfigured()) {
    const [row] = await db()
      .select({ valueEnc: schema.appSettings.valueEnc })
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, RC_ENV_KEY))
      .limit(1);
    if (row) {
      const v = decryptSecret(row.valueEnc);
      if (v === "sandbox" || v === "production") return v;
    }
  }
  return defaultRingCentralEnv();
}

export async function setRingCentralEnv(env: RingCentralEnv): Promise<void> {
  const valueEnc = encryptSecret(env);
  await db()
    .insert(schema.appSettings)
    .values({ key: RC_ENV_KEY, valueEnc, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { valueEnc, updatedAt: new Date() },
    });
}

// ─────────────────────────────────────────────────────────────────────────
// Maintenance mode — a platform-wide switch flipped from the /dev dashboard.
// While on, non-developer users get a maintenance screen instead of the app;
// developers keep working and see a warning banner.
// ─────────────────────────────────────────────────────────────────────────

export interface MaintenanceState {
  /** Manual switch — on until a developer turns it off. */
  enabled: boolean;
  /** Optional custom message shown on the maintenance screen. */
  message: string | null;
  /** Optional scheduled window (ISO datetimes) — activates and ends itself. */
  scheduledStart: string | null;
  scheduledEnd: string | null;
  /** Who flipped it and when — shown on the dev dashboard. */
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface MaintenanceStatus extends MaintenanceState {
  /** Maintenance is in effect right now (manual switch OR inside the window). */
  active: boolean;
  /** A scheduled window exists and hasn't started yet. */
  upcoming: boolean;
}

const MAINTENANCE_KEY = "platform_maintenance";

const MAINTENANCE_OFF: MaintenanceState = {
  enabled: false,
  message: null,
  scheduledStart: null,
  scheduledEnd: null,
  updatedBy: null,
  updatedAt: null,
};

/** The window is evaluated per request — no cron needed to start/stop it. */
function withStatus(state: MaintenanceState): MaintenanceStatus {
  const now = Date.now();
  const start = state.scheduledStart ? Date.parse(state.scheduledStart) : NaN;
  const end = state.scheduledEnd ? Date.parse(state.scheduledEnd) : NaN;
  const inWindow =
    Number.isFinite(start) && Number.isFinite(end) && now >= start && now < end;
  const upcoming = Number.isFinite(start) && Number.isFinite(end) && now < start;
  return { ...state, active: state.enabled || inWindow, upcoming };
}

export async function getMaintenance(): Promise<MaintenanceStatus> {
  if (!isDatabaseConfigured()) return withStatus(MAINTENANCE_OFF);
  const [row] = await db()
    .select({ valueEnc: schema.appSettings.valueEnc })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, MAINTENANCE_KEY))
    .limit(1);
  if (!row) return withStatus(MAINTENANCE_OFF);
  try {
    const parsed = JSON.parse(decryptSecret(row.valueEnc)) as Partial<MaintenanceState>;
    return withStatus({
      enabled: parsed.enabled === true,
      message: parsed.message ?? null,
      scheduledStart: parsed.scheduledStart ?? null,
      scheduledEnd: parsed.scheduledEnd ?? null,
      updatedBy: parsed.updatedBy ?? null,
      updatedAt: parsed.updatedAt ?? null,
    });
  } catch {
    return withStatus(MAINTENANCE_OFF);
  }
}

export async function setMaintenance(state: MaintenanceState): Promise<void> {
  const valueEnc = encryptSecret(JSON.stringify(state));
  await db()
    .insert(schema.appSettings)
    .values({ key: MAINTENANCE_KEY, valueEnc, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { valueEnc, updatedAt: new Date() },
    });
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

// ── Per-client Meta app credentials (leadgen webhook) ────────────────────────

export async function getWorkspaceMetaApp(
  workspaceId: string,
): Promise<{ appId: string | null; appSecret: string | null }> {
  if (!isDatabaseConfigured()) return { appId: null, appSecret: null };
  const [row] = await db()
    .select({
      appId: schema.workspaces.metaAppId,
      enc: schema.workspaces.metaAppSecretEnc,
    })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  return {
    appId: row?.appId ?? null,
    appSecret: row?.enc ? decryptSecret(row.enc) : null,
  };
}

export async function setWorkspaceMetaApp(
  workspaceId: string,
  input: { appId: string; appSecret: string },
): Promise<void> {
  await db()
    .update(schema.workspaces)
    .set({
      metaAppId: input.appId.trim(),
      metaAppSecretEnc: encryptSecret(input.appSecret.trim()),
    })
    .where(eq(schema.workspaces.id, workspaceId));
}

/**
 * Every configured Meta app secret (decrypted), plus the env fallback — the
 * leadgen webhook tries each one against the payload signature, since Meta
 * doesn't say which app is calling.
 */
export async function getAllMetaAppSecrets(): Promise<string[]> {
  const secrets: string[] = [];
  if (isDatabaseConfigured()) {
    const rows = await db()
      .select({ enc: schema.workspaces.metaAppSecretEnc })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.isActive, true));
    for (const r of rows) if (r.enc) secrets.push(decryptSecret(r.enc));
  }
  if (process.env.META_APP_SECRET) secrets.push(process.env.META_APP_SECRET);
  return [...new Set(secrets)];
}

// ── Per-client Anthropic (AI) key ────────────────────────────────────────────

export async function getWorkspaceAnthropicKey(
  workspaceId: string,
): Promise<string | null> {
  if (!isDatabaseConfigured()) return null;
  const [row] = await db()
    .select({ enc: schema.workspaces.anthropicApiKeyEnc })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  return row?.enc ? decryptSecret(row.enc) : null;
}

export async function setWorkspaceAnthropicKey(
  workspaceId: string,
  value: string,
): Promise<void> {
  await db()
    .update(schema.workspaces)
    .set({ anthropicApiKeyEnc: encryptSecret(value.trim()) })
    .where(eq(schema.workspaces.id, workspaceId));
}

export async function getWorkspaceAnthropicKeyPreview(
  workspaceId: string,
): Promise<string | null> {
  const value = await getWorkspaceAnthropicKey(workspaceId);
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
  connectedAt: Date | null;
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
      connectedAt: schema.users.rcConnectedAt,
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
    connectedAt: row.connectedAt,
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

// ─────────────────────────────────────────────────────────────────────────
// Per-user Dialpad OAuth tokens — same pattern as RingCentral. Dialpad refresh
// tokens don't carry an expiry, so refreshExpiresAt stays null.
// ─────────────────────────────────────────────────────────────────────────

export interface DialpadTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
  refreshExpiresAt: Date | null;
  fromNumber: string | null;
  dialpadUserId: string | null;
  connectedAt: Date | null;
}

export async function getDialpadTokens(
  userId: string,
): Promise<DialpadTokens | null> {
  if (!isDatabaseConfigured()) return null;
  const [row] = await db()
    .select({
      access: schema.users.dpAccessTokenEnc,
      refresh: schema.users.dpRefreshTokenEnc,
      expiresAt: schema.users.dpTokenExpiresAt,
      refreshExpiresAt: schema.users.dpRefreshTokenExpiresAt,
      fromNumber: schema.users.dpFromNumber,
      dialpadUserId: schema.users.dpUserId,
      connectedAt: schema.users.dpConnectedAt,
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
    dialpadUserId: row.dialpadUserId,
    connectedAt: row.connectedAt,
  };
}

export interface DialpadTokenUpdate {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
}

/** Full connect: stores tokens + the user's number/id, stamps connectedAt. */
export async function setDialpadTokens(
  userId: string,
  input: DialpadTokenUpdate & {
    fromNumber: string | null;
    dialpadUserId: string | null;
  },
): Promise<void> {
  const now = Date.now();
  await db()
    .update(schema.users)
    .set({
      dpAccessTokenEnc: encryptSecret(input.accessToken),
      dpRefreshTokenEnc: encryptSecret(input.refreshToken),
      dpTokenExpiresAt: new Date(now + input.expiresInSec * 1000),
      dpRefreshTokenExpiresAt: null,
      dpFromNumber: input.fromNumber,
      dpUserId: input.dialpadUserId,
      dpConnectedAt: new Date(now),
    })
    .where(eq(schema.users.id, userId));
}

/** Refresh path: rotates tokens only, keeps fromNumber/userId/connectedAt. */
export async function updateDialpadAccessToken(
  userId: string,
  input: DialpadTokenUpdate,
): Promise<void> {
  const now = Date.now();
  await db()
    .update(schema.users)
    .set({
      dpAccessTokenEnc: encryptSecret(input.accessToken),
      dpRefreshTokenEnc: encryptSecret(input.refreshToken),
      dpTokenExpiresAt: new Date(now + input.expiresInSec * 1000),
    })
    .where(eq(schema.users.id, userId));
}

export async function clearDialpadTokens(userId: string): Promise<void> {
  await db()
    .update(schema.users)
    .set({
      dpAccessTokenEnc: null,
      dpRefreshTokenEnc: null,
      dpTokenExpiresAt: null,
      dpRefreshTokenExpiresAt: null,
      dpFromNumber: null,
      dpUserId: null,
      dpConnectedAt: null,
    })
    .where(eq(schema.users.id, userId));
}

export async function isDialpadConnected(userId: string): Promise<boolean> {
  const tokens = await getDialpadTokens(userId);
  return Boolean(tokens);
}
