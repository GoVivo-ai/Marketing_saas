/**
 * Minimal Google Sheets reader — no SDK. Two auth modes, first configured
 * wins; used by the dispatch module to read the bot's "Alexyah Bot Data"
 * spreadsheet (Schedule/Log tabs):
 *
 *  1. Service account: GOOGLE_SERVICE_ACCOUNT_JSON (key file as one line);
 *     share the sheet with its client_email. Preferred, but the org policy
 *     currently blocks creating SA keys.
 *  2. OAuth refresh token (the dispatch bot's own pattern): GOOGLE_OAUTH_
 *     REFRESH_TOKEN minted for the AUTH_GOOGLE_ID/SECRET client by an
 *     account that can read the sheet (scripts/google-sheets-token.mjs).
 *
 *  Plus DISPATCH_SHEET_ID (the spreadsheet id from its URL) in both modes.
 */
import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (!parsed.client_email || !parsed.private_key) return null;
    return parsed as ServiceAccount;
  } catch {
    return null;
  }
}

function oauthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN &&
      process.env.AUTH_GOOGLE_ID &&
      process.env.AUTH_GOOGLE_SECRET,
  );
}

export function isSheetsConfigured(): boolean {
  return (
    (serviceAccount() !== null || oauthConfigured()) &&
    Boolean(process.env.DISPATCH_SHEET_ID)
  );
}

async function refreshTokenGrant(): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.AUTH_GOOGLE_ID ?? "",
      client_secret: process.env.AUTH_GOOGLE_SECRET ?? "",
      refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN ?? "",
    }),
  });
  if (!res.ok)
    throw new Error(`Google refresh failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

const b64url = (data: string | Buffer) =>
  Buffer.from(data).toString("base64url");

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000)
    return cachedToken.token;

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(sa.private_key).toString("base64url");
  const assertion = `${header}.${claims}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok)
    throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

/**
 * Reads a tab (e.g. "Schedule" or "Schedule!A1:G500") and returns its rows as
 * string arrays — the first row is the header. Throws when unconfigured; call
 * {@link isSheetsConfigured} first on user-facing paths.
 */
export async function readSheetRange(range: string): Promise<string[][]> {
  const sa = serviceAccount();
  const sheetId = process.env.DISPATCH_SHEET_ID;
  if ((!sa && !oauthConfigured()) || !sheetId)
    throw new Error("Google Sheets access not configured");
  const token =
    cachedToken && Date.now() < cachedToken.expiresAt - 60_000
      ? cachedToken.token
      : sa
        ? await accessToken(sa)
        : await refreshTokenGrant();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    // The bot refreshes the sheet every 10 minutes — no point caching longer.
    next: { revalidate: 120 },
  });
  if (!res.ok)
    throw new Error(`Sheets read failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { values?: string[][] };
  return data.values ?? [];
}
