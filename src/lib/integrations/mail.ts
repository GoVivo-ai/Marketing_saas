/**
 * Gmail / Outlook as the agent's own outbox.
 *
 * Each user connects their mailbox by OAuth and the platform sends lead
 * emails through it, so the lead sees the agent's real address and replies
 * land in the agent's inbox. The provider also drops a copy in Sent — the
 * platform never becomes the system of record for mail, it only logs that an
 * email went out.
 *
 * Both providers reuse app registrations the platform already has: Google
 * SSO's client (AUTH_GOOGLE_ID/SECRET, which must list
 * /api/mail/gmail/callback as a redirect URI and have the Gmail API enabled)
 * and the Entra app (MS_CLIENT_ID + MS_GRAPH_CLIENT_SECRET, multi-tenant,
 * delegated Mail.Send, /api/mail/outlook/callback registered). Override with
 * MS_MAIL_CLIENT_ID / MS_MAIL_CLIENT_SECRET / MS_MAIL_TENANT if the mail app
 * is a different registration.
 */
import { createHash, randomBytes } from "node:crypto";

export const MAIL_PROVIDERS = ["gmail", "outlook"] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];

export const MAIL_PROVIDER_LABEL: Record<MailProvider, string> = {
  gmail: "Gmail",
  outlook: "Outlook",
};

export function isMailProvider(v: string | null | undefined): v is MailProvider {
  return (MAIL_PROVIDERS as readonly string[]).includes(v ?? "");
}

export class MailError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
  ) {
    super(message);
    this.name = "MailError";
  }
}

/** The user has no mailbox connected, or the connection died and was cleared. */
export class MailNotConnectedError extends Error {
  constructor(message = "Connect your Gmail or Outlook in Settings to send email.") {
    super(message);
    this.name = "MailNotConnectedError";
  }
}

interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
}

function providerConfig(provider: MailProvider): ProviderConfig | null {
  if (provider === "gmail") {
    const clientId = process.env.AUTH_GOOGLE_ID;
    const clientSecret = process.env.AUTH_GOOGLE_SECRET;
    if (!clientId || !clientSecret) return null;
    return {
      clientId,
      clientSecret,
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      // gmail.send only — the platform never reads the agent's mailbox.
      scope: "openid email profile https://www.googleapis.com/auth/gmail.send",
    };
  }
  const clientId = process.env.MS_MAIL_CLIENT_ID ?? process.env.MS_CLIENT_ID;
  const clientSecret =
    process.env.MS_MAIL_CLIENT_SECRET ?? process.env.MS_GRAPH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  // "common" lets work/school AND personal Microsoft accounts sign in; the
  // registration must be multi-tenant for that. Pin a tenant id to restrict.
  const tenant = process.env.MS_MAIL_TENANT ?? "common";
  return {
    clientId,
    clientSecret,
    authorizeUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    scope: "openid email profile offline_access User.Read Mail.Send",
  };
}

export function isMailProviderConfigured(provider: MailProvider): boolean {
  return providerConfig(provider) !== null;
}

export function configuredMailProviders(): MailProvider[] {
  return MAIL_PROVIDERS.filter(isMailProviderConfigured);
}

// ── OAuth ────────────────────────────────────────────────────────────────────

const b64url = (b: Buffer) => b.toString("base64url");

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function generateState(): string {
  return b64url(randomBytes(16));
}

export function buildMailAuthorizeUrl(opts: {
  provider: MailProvider;
  state: string;
  codeChallenge: string;
  redirectUri: string;
}): string {
  const cfg = providerConfig(opts.provider);
  if (!cfg) throw new MailError(`${MAIL_PROVIDER_LABEL[opts.provider]} is not configured`);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: opts.redirectUri,
    scope: cfg.scope,
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
  });
  if (opts.provider === "gmail") {
    // Google only hands out a refresh token on an offline + consent request.
    params.set("access_type", "offline");
    params.set("prompt", "consent");
  } else {
    params.set("response_mode", "query");
    params.set("prompt", "select_account");
  }
  return `${cfg.authorizeUrl}?${params.toString()}`;
}

export interface MailTokens {
  accessToken: string;
  /** Google omits it on refresh — callers keep the previous one then. */
  refreshToken: string | null;
  expiresInSec: number;
}

async function tokenRequest(
  provider: MailProvider,
  body: Record<string, string>,
): Promise<MailTokens> {
  const cfg = providerConfig(provider);
  if (!cfg) throw new MailError(`${MAIL_PROVIDER_LABEL[provider]} is not configured`);
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      ...body,
    }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new MailError(
      String(json.error_description ?? json.error ?? `Token request failed (${res.status})`),
      res.status,
      typeof json.error === "string" ? json.error : undefined,
    );
  }
  return {
    accessToken: String(json.access_token),
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : null,
    expiresInSec: Number(json.expires_in ?? 3600),
  };
}

export function exchangeMailCode(opts: {
  provider: MailProvider;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<MailTokens> {
  return tokenRequest(opts.provider, {
    grant_type: "authorization_code",
    code: opts.code,
    code_verifier: opts.codeVerifier,
    redirect_uri: opts.redirectUri,
  });
}

export function refreshMailTokens(
  provider: MailProvider,
  refreshToken: string,
): Promise<MailTokens> {
  const body: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  };
  // Microsoft wants the scope restated on refresh; Google rejects it.
  if (provider === "outlook") body.scope = providerConfig(provider)!.scope;
  return tokenRequest(provider, body);
}

// ── Identity ─────────────────────────────────────────────────────────────────

export interface MailIdentity {
  address: string;
  name: string | null;
}

/** Who the connected mailbox belongs to — shown in Settings, used as From. */
export async function fetchMailIdentity(
  provider: MailProvider,
  accessToken: string,
): Promise<MailIdentity> {
  const url =
    provider === "gmail"
      ? "https://www.googleapis.com/oauth2/v3/userinfo"
      : "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName";
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) throw new MailError(`Could not read the account profile (${res.status})`, res.status);
  const j = (await res.json()) as Record<string, unknown>;
  if (provider === "gmail") {
    if (typeof j.email !== "string") throw new MailError("Google did not return an email address");
    return { address: j.email, name: typeof j.name === "string" ? j.name : null };
  }
  const address = (j.mail ?? j.userPrincipalName) as string | undefined;
  if (!address) throw new MailError("Microsoft did not return an email address");
  return { address, name: typeof j.displayName === "string" ? j.displayName : null };
}

// ── Send ─────────────────────────────────────────────────────────────────────

export interface OutgoingMail {
  from: MailIdentity;
  to: string;
  subject: string;
  /** Plain text. Agents write prose, not HTML; providers render it as-is. */
  text: string;
}

/** RFC 2047 for non-ASCII header values (names, accented subjects). */
function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function rfc822(mail: OutgoingMail): string {
  const from = mail.from.name
    ? `${encodeHeader(mail.from.name)} <${mail.from.address}>`
    : mail.from.address;
  const body = Buffer.from(mail.text, "utf8")
    .toString("base64")
    .replace(/(.{76})/g, "$1\r\n");
  return [
    `From: ${from}`,
    `To: ${mail.to}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

/** Sends through the provider; the provider files the copy in Sent. */
export async function sendMailMessage(
  provider: MailProvider,
  accessToken: string,
  mail: OutgoingMail,
): Promise<{ messageId: string | null }> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  if (provider === "gmail") {
    const res = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ raw: Buffer.from(rfc822(mail), "utf8").toString("base64url") }),
        cache: "no-store",
      },
    );
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw providerError("Gmail", res.status, j);
    return { messageId: typeof j.id === "string" ? j.id : null };
  }
  const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers,
    body: JSON.stringify({
      message: {
        subject: mail.subject,
        body: { contentType: "Text", content: mail.text },
        toRecipients: [{ emailAddress: { address: mail.to } }],
      },
      saveToSentItems: true,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw providerError("Outlook", res.status, j);
  }
  // Graph answers 202 with no body; the message id isn't exposed here.
  return { messageId: null };
}

function providerError(label: string, status: number, j: Record<string, unknown>): MailError {
  const err = j.error as Record<string, unknown> | string | undefined;
  const message =
    typeof err === "object" && err && typeof err.message === "string"
      ? err.message
      : typeof j.error_description === "string"
        ? j.error_description
        : `${label} refused the message (${status})`;
  const code =
    typeof err === "object" && err && typeof err.code === "string"
      ? err.code
      : typeof err === "string"
        ? err
        : undefined;
  return new MailError(message, status, code);
}
