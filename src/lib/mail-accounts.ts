/**
 * Persistence and token care for the per-user mailbox (see
 * integrations/mail.ts for the provider calls). One row per user; a refresh
 * that the provider rejects for good clears the row so Settings shows
 * "not connected" instead of a silently broken Send button.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import {
  MailNotConnectedError,
  isMailProvider,
  refreshMailTokens,
  sendMailMessage,
  type MailIdentity,
  type MailProvider,
  type MailTokens,
} from "@/lib/integrations/mail";

export interface MailAccountSummary {
  provider: MailProvider;
  address: string;
  displayName: string | null;
  connectedAt: string;
  lastError: string | null;
}

export async function getMailAccount(userId: string): Promise<MailAccountSummary | null> {
  const [row] = await db()
    .select({
      provider: schema.mailAccounts.provider,
      address: schema.mailAccounts.address,
      displayName: schema.mailAccounts.displayName,
      connectedAt: schema.mailAccounts.connectedAt,
      lastError: schema.mailAccounts.lastError,
    })
    .from(schema.mailAccounts)
    .where(eq(schema.mailAccounts.userId, userId))
    .limit(1);
  if (!row || !isMailProvider(row.provider)) return null;
  return {
    provider: row.provider,
    address: row.address,
    displayName: row.displayName,
    connectedAt: row.connectedAt.toISOString(),
    lastError: row.lastError,
  };
}

/** Connect (or reconnect): replaces whatever mailbox the user had before. */
export async function saveMailAccount(
  userId: string,
  input: { provider: MailProvider; identity: MailIdentity; tokens: MailTokens },
): Promise<void> {
  if (!input.tokens.refreshToken) {
    throw new Error(
      "The provider did not return a refresh token — revoke the app's access in your account and connect again.",
    );
  }
  const values = {
    userId,
    provider: input.provider,
    address: input.identity.address,
    displayName: input.identity.name,
    accessTokenEnc: encryptSecret(input.tokens.accessToken),
    refreshTokenEnc: encryptSecret(input.tokens.refreshToken),
    tokenExpiresAt: new Date(Date.now() + input.tokens.expiresInSec * 1000),
    connectedAt: new Date(),
    lastError: null,
  };
  await db()
    .insert(schema.mailAccounts)
    .values(values)
    .onConflictDoUpdate({ target: schema.mailAccounts.userId, set: values });
}

export async function clearMailAccount(userId: string): Promise<void> {
  await db().delete(schema.mailAccounts).where(eq(schema.mailAccounts.userId, userId));
}

const REFRESH_MARGIN_MS = 60_000;

async function getValidMailAccess(userId: string): Promise<{
  provider: MailProvider;
  identity: MailIdentity;
  accessToken: string;
}> {
  const [row] = await db()
    .select()
    .from(schema.mailAccounts)
    .where(eq(schema.mailAccounts.userId, userId))
    .limit(1);
  if (!row || !isMailProvider(row.provider)) throw new MailNotConnectedError();
  const identity: MailIdentity = { address: row.address, name: row.displayName };

  let accessToken: string;
  let refreshToken: string;
  try {
    accessToken = decryptSecret(row.accessTokenEnc);
    refreshToken = decryptSecret(row.refreshTokenEnc);
  } catch {
    // Encryption key rotated: the stored tokens are unreadable for good.
    await clearMailAccount(userId);
    throw new MailNotConnectedError("Your email connection is no longer valid — reconnect it in Settings.");
  }

  if (row.tokenExpiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS) {
    return { provider: row.provider, identity, accessToken };
  }

  try {
    const fresh = await refreshMailTokens(row.provider, refreshToken);
    await db()
      .update(schema.mailAccounts)
      .set({
        accessTokenEnc: encryptSecret(fresh.accessToken),
        refreshTokenEnc: encryptSecret(fresh.refreshToken ?? refreshToken),
        tokenExpiresAt: new Date(Date.now() + fresh.expiresInSec * 1000),
        lastError: null,
      })
      .where(eq(schema.mailAccounts.userId, userId));
    return { provider: row.provider, identity, accessToken: fresh.accessToken };
  } catch (err) {
    const code = (err as { code?: string }).code;
    // invalid_grant = the user revoked access or the refresh token expired;
    // nothing short of reconnecting will fix it, so stop pretending.
    if (code === "invalid_grant") {
      await clearMailAccount(userId);
      throw new MailNotConnectedError(
        "Your email connection expired — reconnect Gmail or Outlook in Settings.",
      );
    }
    await db()
      .update(schema.mailAccounts)
      .set({ lastError: err instanceof Error ? err.message : String(err) })
      .where(eq(schema.mailAccounts.userId, userId));
    throw err;
  }
}

/** Sends one email as the user; the caller logs it on the lead. */
export async function sendMailAs(
  userId: string,
  mail: { to: string; subject: string; text: string },
): Promise<{ provider: MailProvider; from: string; messageId: string | null }> {
  const { provider, identity, accessToken } = await getValidMailAccess(userId);
  try {
    const { messageId } = await sendMailMessage(provider, accessToken, {
      from: identity,
      ...mail,
    });
    return { provider, from: identity.address, messageId };
  } catch (err) {
    await db()
      .update(schema.mailAccounts)
      .set({ lastError: err instanceof Error ? err.message : String(err) })
      .where(eq(schema.mailAccounts.userId, userId));
    throw err;
  }
}
