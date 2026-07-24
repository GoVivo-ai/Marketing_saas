import { createHash, randomBytes } from "node:crypto";
import {
  getRingCentralTokens,
  updateRingCentralAccessToken,
  clearRingCentralTokens,
  getRingCentralEnv,
  type RingCentralEnv,
} from "@/lib/settings";

/**
 * RingCentral connector — OAuth 2.0 (Authorization Code + PKCE), RingOut
 * (click-to-call) and SMS. Raw fetch, no SDK (mirrors the Meta connector).
 *
 * App-level config (env): RINGCENTRAL_CLIENT_ID, RINGCENTRAL_CLIENT_SECRET,
 * RINGCENTRAL_SERVER_URL (https://platform.ringcentral.com for production or
 * https://platform.devtest.ringcentral.com for sandbox).
 */

export class RingCentralNotConnectedError extends Error {
  constructor() {
    super("RingCentral is not connected");
    this.name = "RingCentralNotConnectedError";
  }
}

export class RingCentralError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RingCentralError";
  }
}

export class BadPhoneError extends Error {
  constructor(raw: string) {
    super(`Phone number is not in E.164 format: ${raw}`);
    this.name = "BadPhoneError";
  }
}

interface RcConfig {
  clientId: string;
  clientSecret: string;
  server: string;
}

const DEFAULT_SERVER: Record<RingCentralEnv, string> = {
  production: "https://platform.ringcentral.com",
  sandbox: "https://platform.devtest.ringcentral.com",
};

/** Resolve the credential set + server URL for the active environment. */
function envConfig(env: RingCentralEnv): RcConfig {
  if (env === "sandbox") {
    return {
      clientId: process.env.RINGCENTRAL_SANDBOX_CLIENT_ID ?? "",
      clientSecret: process.env.RINGCENTRAL_SANDBOX_CLIENT_SECRET ?? "",
      server: (
        process.env.RINGCENTRAL_SANDBOX_SERVER_URL ?? DEFAULT_SERVER.sandbox
      ).replace(/\/$/, ""),
    };
  }
  return {
    clientId: process.env.RINGCENTRAL_CLIENT_ID ?? "",
    clientSecret: process.env.RINGCENTRAL_CLIENT_SECRET ?? "",
    server: (
      process.env.RINGCENTRAL_SERVER_URL ?? DEFAULT_SERVER.production
    ).replace(/\/$/, ""),
  };
}

/** Active config, honoring the admin-global environment toggle. */
async function rcConfig(): Promise<RcConfig> {
  const cfg = envConfig(await getRingCentralEnv());
  if (!cfg.server) throw new RingCentralError("RingCentral server URL is not set");
  return cfg;
}

/** Whether the *active* environment has all credentials needed to connect. */
export async function isRingCentralConfigured(): Promise<boolean> {
  const cfg = envConfig(await getRingCentralEnv());
  return Boolean(cfg.clientId && cfg.clientSecret && cfg.server);
}

const basicAuthHeader = (cfg: RcConfig) =>
  "Basic " +
  Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");

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
export async function buildAuthorizeUrl(opts: {
  state: string;
  codeChallenge: string;
  redirectUri: string;
}): Promise<string> {
  const cfg = await rcConfig();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: opts.redirectUri,
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${cfg.server}/restapi/oauth/authorize?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_token_expires_in: number;
  owner_id?: string;
  token_type: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const cfg = await rcConfig();
  const res = await fetch(`${cfg.server}/restapi/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(cfg),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new RingCentralError(`OAuth token error ${res.status}: ${text.slice(0, 300)}`);
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

// ── Authenticated API calls ──────────────────────────────────────────────────
async function apiFetch(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<unknown> {
  const cfg = await rcConfig();
  const res = await fetch(`${cfg.server}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new RingCentralError(`RingCentral ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

/** Picks the user's best "from" number (prefer SMS+voice capable). */
export async function fetchPrimaryNumber(
  accessToken: string,
): Promise<{ phoneNumber: string; smsCapable: boolean } | null> {
  const data = (await apiFetch(
    "/restapi/v1.0/account/~/extension/~/phone-number?perPage=100",
    accessToken,
  )) as {
    records?: { phoneNumber?: string; features?: string[]; usageType?: string }[];
  };
  const records = (data.records ?? []).filter((r) => r.phoneNumber);
  if (records.length === 0) return null;
  const smsNumber = records.find((r) => r.features?.includes("SmsSender"));
  const direct =
    records.find((r) => r.usageType === "DirectNumber") ?? records[0];
  const chosen = smsNumber ?? direct;
  return {
    phoneNumber: chosen.phoneNumber!,
    smsCapable: Boolean(chosen.features?.includes("SmsSender")),
  };
}

/**
 * Returns a valid access token for the user, refreshing+persisting it when the
 * current one is expired. Throws RingCentralNotConnectedError if unrecoverable.
 */
async function getValidAccessToken(
  userId: string,
): Promise<{ accessToken: string; fromNumber: string | null }> {
  const tokens = await getRingCentralTokens(userId);
  if (!tokens) throw new RingCentralNotConnectedError();

  const skewMs = 60_000;
  if (tokens.expiresAt && tokens.expiresAt.getTime() - skewMs > Date.now()) {
    return { accessToken: tokens.accessToken, fromNumber: tokens.fromNumber };
  }

  if (tokens.refreshExpiresAt && tokens.refreshExpiresAt.getTime() <= Date.now()) {
    await clearRingCentralTokens(userId);
    throw new RingCentralNotConnectedError();
  }

  try {
    const res = await refreshTokens(tokens.refreshToken);
    await updateRingCentralAccessToken(userId, {
      accessToken: res.access_token,
      refreshToken: res.refresh_token,
      expiresInSec: res.expires_in,
      refreshExpiresInSec: res.refresh_token_expires_in,
    });
    return { accessToken: res.access_token, fromNumber: tokens.fromNumber };
  } catch {
    await clearRingCentralTokens(userId);
    throw new RingCentralNotConnectedError();
  }
}

/** Strip formatting; require a leading "+" and 6–15 digits (assume E.164 input). */
export function normalizeE164(raw: string): string {
  const cleaned = raw.replace(/[\s\-().]/g, "");
  if (!/^\+\d{6,15}$/.test(cleaned)) throw new BadPhoneError(raw);
  return cleaned;
}

// ── Actions ──────────────────────────────────────────────────────────────────

/** Click-to-call: rings the user's own RC number first, then dials the lead. */
export async function ringOut(
  userId: string,
  to: string,
): Promise<{ id: string; status: unknown }> {
  const { accessToken, fromNumber } = await getValidAccessToken(userId);
  if (!fromNumber)
    throw new RingCentralError("No RingCentral number is set on your account");
  const res = (await apiFetch(
    "/restapi/v1.0/account/~/extension/~/ring-out",
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        from: { phoneNumber: fromNumber },
        to: { phoneNumber: to },
        playPrompt: false,
      }),
    },
  )) as { id: string; status: unknown };
  return res;
}

/** One voice call from the user's RingCentral extension call log. */
export interface RcCallLogRecord {
  id: string;
  direction: string | null; // "Inbound" | "Outbound"
  from: string | null;
  to: string | null;
  startTime: Date;
  durationSec: number;
  result: string | null; // "Call connected" | "Missed" | "Voicemail" | …
}

interface RcCallLogPage {
  records?: {
    id?: string;
    telephonySessionId?: string;
    direction?: string;
    from?: { phoneNumber?: string; extensionNumber?: string };
    to?: { phoneNumber?: string; extensionNumber?: string };
    startTime?: string;
    duration?: number;
    result?: string;
  }[];
  navigation?: { nextPage?: { uri?: string } };
}

/**
 * Fetches the user's voice call log since `dateFrom`, following pagination.
 * Uses view=Simple (no recordings/legs) — enough for duration + result.
 */
export async function fetchCallLog(
  userId: string,
  opts: { dateFrom: Date; dateTo?: Date },
): Promise<RcCallLogRecord[]> {
  const { accessToken } = await getValidAccessToken(userId);
  const cfg = await rcConfig();
  const params = new URLSearchParams({
    view: "Simple",
    type: "Voice",
    perPage: "250",
    dateFrom: opts.dateFrom.toISOString(),
  });
  if (opts.dateTo) params.set("dateTo", opts.dateTo.toISOString());

  const out: RcCallLogRecord[] = [];
  let url: string | null =
    `${cfg.server}/restapi/v1.0/account/~/extension/~/call-log?${params.toString()}`;
  // Hard page cap so a pathological navigation loop can't hang the sync.
  for (let page = 0; url && page < 20; page++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new RingCentralError(
        `Call log ${res.status}: ${text.slice(0, 300)}`,
      );
    }
    const data = (await res.json()) as RcCallLogPage;
    for (const r of data.records ?? []) {
      if (!r.id || !r.startTime) continue;
      out.push({
        // Prefer the telephony session id: the widget's client-side capture
        // reports the same value, so both sources dedupe onto one row.
        id: r.telephonySessionId ?? r.id,
        direction: r.direction ?? null,
        from: r.from?.phoneNumber ?? r.from?.extensionNumber ?? null,
        to: r.to?.phoneNumber ?? r.to?.extensionNumber ?? null,
        startTime: new Date(r.startTime),
        durationSec: r.duration ?? 0,
        result: r.result ?? null,
      });
    }
    url = data.navigation?.nextPage?.uri ?? null;
  }
  return out;
}

export async function sendSms(
  userId: string,
  to: string,
  text: string,
): Promise<{ id: string }> {
  const { accessToken, fromNumber } = await getValidAccessToken(userId);
  if (!fromNumber)
    throw new RingCentralError("No RingCentral number is set on your account");
  const res = (await apiFetch(
    "/restapi/v1.0/account/~/extension/~/sms",
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        from: { phoneNumber: fromNumber },
        to: [{ phoneNumber: to }],
        text,
      }),
    },
  )) as { id: string };
  return res;
}
