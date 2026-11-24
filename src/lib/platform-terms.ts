import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * Current Platform Terms (https://www.govivo.ai/platform-terms). Bump this
 * whenever the published terms change: every user is asked to accept again,
 * and terms_acceptances keeps one row per user per version.
 */
export const PLATFORM_TERMS_VERSION = "platform-terms-v1.0";
export const PLATFORM_TERMS_URL = "https://www.govivo.ai/platform-terms";
export const PRIVACY_POLICY_URL = "https://www.govivo.ai/privacy-policy";

export async function hasAcceptedPlatformTerms(userId: string): Promise<boolean> {
  const [row] = await db()
    .select({ id: schema.termsAcceptances.id })
    .from(schema.termsAcceptances)
    .where(
      and(
        eq(schema.termsAcceptances.userId, userId),
        eq(schema.termsAcceptances.version, PLATFORM_TERMS_VERSION),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function recordPlatformTermsAcceptance(input: {
  userId: string;
  email: string;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<void> {
  await db()
    .insert(schema.termsAcceptances)
    .values({ ...input, version: PLATFORM_TERMS_VERSION })
    .onConflictDoNothing();
}
