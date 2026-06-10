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
