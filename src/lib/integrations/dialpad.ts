import { createHash, randomBytes } from "node:crypto";
import { normalizeE164 } from "@/lib/integrations/ringcentral";
import {
  getDialpadTokens,
  updateDialpadAccessToken,
  clearDialpadTokens,
} from "@/lib/settings";

/**
 * Dialpad connector — OAuth 2.0 (Authorization Code + PKCE), click-to-call
 * (rings the user's Dialpad devices, then dials the lead) and SMS. Raw fetch,
 * no SDK (mirrors the RingCentral/Meta connectors).
 *
 * App-level config (env): DIALPAD_CLIENT_ID, DIALPAD_CLIENT_SECRET,
 * DIALPAD_SERVER_URL (https://dialpad.com for production or
 * https://sandbox.dialpad.com for sandbox). Optional DIALPAD_SCOPES — a
 * space-separated list of extra scopes the agency's app was approved for.
 */

export class DialpadNotConnectedError extends Error {
  constructor() {
    super("Dialpad is not connected");
    this.name = "DialpadNotConnectedError";
  }
}

export class DialpadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DialpadError";
  }
}

const SERVER = () => {
  const url = process.env.DIALPAD_SERVER_URL;
  if (!url) throw new DialpadError("DIALPAD_SERVER_URL is not set");
  return url.replace(/\/$/, "");
};

const clientId = () => process.env.DIALPAD_CLIENT_ID ?? "";
const clientSecret = () => process.env.DIALPAD_CLIENT_SECRET ?? "";

export const isDialpadConfigured = () =>
  Boolean(
    process.env.DIALPAD_CLIENT_ID &&
      process.env.DIALPAD_CLIENT_SECRET &&
      process.env.DIALPAD_SERVER_URL,
  );

const b64url = (buf: Buffer) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ── PKCE ───────────────────────────────────────────────────────────────────
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function generateState(): string {
  return b64url(randomBytes(16));
}

// ── OAuth ────────────────────────────────────────────────────────────────────
export function buildAuthorizeUrl(opts: {
  state: string;
  codeChallenge: string;
  redirectUri: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId(),
    redirect_uri: opts.redirectUri,
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
  });
  const scopes = process.env.DIALPAD_SCOPES?.trim();
  if (scopes) params.set("scope", scopes);
  return `${SERVER()}/oauth2/authorize?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  token_type: string;
}

/**
 * Dialpad sometimes reports `expires_in` as an absolute unix timestamp rather
 * than a TTL in seconds. Normalize either form to a positive TTL in seconds.
 */
function toExpiresInSec(expiresIn: number | undefined): number {
  if (!expiresIn || expiresIn <= 0) return 3600;
  if (expiresIn > 1_000_000_000) {
    const ttl = expiresIn - Math.floor(Date.now() / 1000);
    return ttl > 0 ? ttl : 3600;
  }
  return expiresIn;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${SERVER()}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...body,
      client_id: clientId(),
      client_secret: clientSecret(),
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new DialpadError(`OAuth token error ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

export function exchangeCode(opts: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  return tokenRequest({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.codeVerifier,
  });
}

export function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  return tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

// ── Authenticated API calls (base: {SERVER}/api/v2) ──────────────────────────
async function apiFetch(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<unknown> {
  const res = await fetch(`${SERVER()}/api/v2${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new DialpadError(`Dialpad ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

/** Identifies the connected user — needed because call/SMS are keyed by user_id. */
export async function fetchMe(
  accessToken: string,
): Promise<{ dialpadUserId: string; phoneNumber: string | null }> {
  const data = (await apiFetch("/users/me", accessToken)) as {
    id?: number | string;
    phone_numbers?: string[];
  };
  const id = data.id != null ? String(data.id) : null;
  if (!id) throw new DialpadError("Could not read the Dialpad user id");
  const phoneNumber =
    Array.isArray(data.phone_numbers) && data.phone_numbers.length > 0
      ? data.phone_numbers[0]
      : null;
  return { dialpadUserId: id, phoneNumber };
}

/**
 * Returns a valid access token (+ the Dialpad user id) for the user, refreshing
 * and persisting it when expired. Throws DialpadNotConnectedError if unrecoverable.
 */
async function getValidAccessToken(
  userId: string,
): Promise<{ accessToken: string; dialpadUserId: string | null }> {
  const tokens = await getDialpadTokens(userId);
  if (!tokens) throw new DialpadNotConnectedError();

  const skewMs = 60_000;
  if (tokens.expiresAt && tokens.expiresAt.getTime() - skewMs > Date.now()) {
    return { accessToken: tokens.accessToken, dialpadUserId: tokens.dialpadUserId };
  }

  try {
    const res = await refreshTokens(tokens.refreshToken);
    await updateDialpadAccessToken(userId, {
      accessToken: res.access_token,
      refreshToken: res.refresh_token,
      expiresInSec: toExpiresInSec(res.expires_in),
    });
    return { accessToken: res.access_token, dialpadUserId: tokens.dialpadUserId };
  } catch {
    await clearDialpadTokens(userId);
    throw new DialpadNotConnectedError();
  }
}

// ── Actions ──────────────────────────────────────────────────────────────────

/** Click-to-call: rings the user's own Dialpad devices first, then the lead. */
export async function placeCall(
  userId: string,
  to: string,
): Promise<{ id: string }> {
  const { accessToken, dialpadUserId } = await getValidAccessToken(userId);
  if (!dialpadUserId)
    throw new DialpadError("No Dialpad user is set on your account");
  const res = (await apiFetch("/call", accessToken, {
    method: "POST",
    body: JSON.stringify({
      user_id: Number(dialpadUserId),
      phone_number: normalizeE164(to),
    }),
  })) as { call_id?: string | number; id?: string | number };
  return { id: String(res.call_id ?? res.id ?? "") };
}

export async function sendSms(
  userId: string,
  to: string,
  text: string,
): Promise<{ id: string }> {
  const { accessToken, dialpadUserId } = await getValidAccessToken(userId);
  if (!dialpadUserId)
    throw new DialpadError("No Dialpad user is set on your account");
  const res = (await apiFetch("/sms", accessToken, {
    method: "POST",
    body: JSON.stringify({
      user_id: Number(dialpadUserId),
      to_numbers: [normalizeE164(to)],
      text,
    }),
  })) as { id?: string | number };
  return { id: String(res.id ?? "") };
}

export { toExpiresInSec };
