import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Role } from "@/lib/permissions";

/**
 * Minimal OAuth 2.1 authorization server for the MCP endpoint: Dynamic
 * Client Registration, authorization-code + PKCE (S256, mandatory), refresh
 * tokens with rotation, and revocation. Tokens are opaque random strings;
 * only their SHA-256 hashes are stored.
 *
 * Why not delegate to next-auth: it is the identity provider for the app's
 * own sessions (the consent page reuses it), but it does not issue tokens
 * to third-party clients, which is exactly what MCP clients need.
 */

export const OAUTH_SCOPES = ["read"] as const;
const ACCESS_TTL_MS = 60 * 60_000; // 1 h
const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000; // 30 d
const CODE_TTL_MS = 10 * 60_000; // 10 min

export const ACCESS_TOKEN_PREFIX = "vivo_at_";
const REFRESH_TOKEN_PREFIX = "vivo_rt_";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const random = (bytes: number) => randomBytes(bytes).toString("hex");

/** Constant-time string comparison that tolerates differing lengths. */
function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ── Base URL ───────────────────────────────────────────────────────────────

/**
 * Public origin of this deployment, used as the OAuth issuer and to build
 * endpoint URLs. NEXT_PUBLIC_APP_URL wins; otherwise the request's
 * forwarded host (what Vercel and any reverse proxy set).
 */
export function baseUrl(req?: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (env) return env;
  if (!req) return "http://localhost:3000";
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export function oauthEndpoints(base: string) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    resource: `${base}/api/mcp`,
    resource_metadata: `${base}/.well-known/oauth-protected-resource/api/mcp`,
  };
}

// ── Clients (RFC 7591) ─────────────────────────────────────────────────────

export const AUTH_METHODS = ["none", "client_secret_post", "client_secret_basic"] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

export class OAuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** Only https redirects, plus loopback http for CLI clients like Claude Code. */
export function isAllowedRedirectUri(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:") {
    return u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  }
  return false;
}

export async function registerClient(input: {
  client_name?: unknown;
  redirect_uris?: unknown;
  token_endpoint_auth_method?: unknown;
}) {
  const uris = Array.isArray(input.redirect_uris)
    ? input.redirect_uris.filter((u): u is string => typeof u === "string")
    : [];
  if (uris.length === 0 || !uris.every(isAllowedRedirectUri)) {
    throw new OAuthError(
      "invalid_redirect_uri",
      "redirect_uris must be https URLs (or http://localhost for local tools).",
    );
  }
  const method = (
    typeof input.token_endpoint_auth_method === "string"
      ? input.token_endpoint_auth_method
      : "none"
  ) as AuthMethod;
  if (!AUTH_METHODS.includes(method)) {
    throw new OAuthError("invalid_client_metadata", "Unsupported token_endpoint_auth_method.");
  }
  const name =
    typeof input.client_name === "string" && input.client_name.trim()
      ? input.client_name.trim().slice(0, 100)
      : "MCP client";

  const id = "vc_" + random(16);
  const secret = method === "none" ? null : "vcs_" + random(32);
  await db().insert(schema.oauthClients).values({
    id,
    name,
    secretHash: secret ? sha256(secret) : null,
    redirectUris: uris,
    tokenEndpointAuthMethod: method,
  });
  return { id, name, secret, uris, method };
}

export async function getClient(clientId: string) {
  const [c] = await db()
    .select()
    .from(schema.oauthClients)
    .where(eq(schema.oauthClients.id, clientId))
    .limit(1);
  return c ?? null;
}

/**
 * Authenticates the client on the token endpoint: confidential clients must
 * present their secret (POST body or HTTP Basic), public ones must not.
 */
export async function authenticateClient(req: Request, body: URLSearchParams) {
  let clientId = body.get("client_id");
  let secret = body.get("client_secret");
  const basic = req.headers.get("authorization");
  if (basic?.toLowerCase().startsWith("basic ")) {
    const [id, sec] = Buffer.from(basic.slice(6), "base64").toString().split(":");
    clientId = decodeURIComponent(id ?? "");
    secret = decodeURIComponent(sec ?? "");
  }
  if (!clientId) throw new OAuthError("invalid_client", "Missing client_id.", 401);
  const client = await getClient(clientId);
  if (!client) throw new OAuthError("invalid_client", "Unknown client.", 401);
  if (client.secretHash) {
    if (!secret || !safeEqual(sha256(secret), client.secretHash)) {
      throw new OAuthError("invalid_client", "Bad client credentials.", 401);
    }
  }
  return client;
}

// ── Authorization codes ────────────────────────────────────────────────────

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  state: string | null;
  resource: string | null;
}

/** Validates the authorize request; throws OAuthError for anything off. */
export async function validateAuthorizeRequest(q: URLSearchParams): Promise<
  AuthorizeParams & { clientName: string }
> {
  const clientId = q.get("client_id") ?? "";
  const client = clientId ? await getClient(clientId) : null;
  if (!client) throw new OAuthError("invalid_client", "Unknown client_id.");
  const redirectUri = q.get("redirect_uri") ?? "";
  if (!client.redirectUris.includes(redirectUri)) {
    throw new OAuthError("invalid_request", "redirect_uri is not registered for this client.");
  }
  if (q.get("response_type") !== "code") {
    throw new OAuthError("unsupported_response_type", "Only response_type=code is supported.");
  }
  const codeChallenge = q.get("code_challenge") ?? "";
  if (!codeChallenge || (q.get("code_challenge_method") ?? "S256") !== "S256") {
    throw new OAuthError("invalid_request", "PKCE with code_challenge_method=S256 is required.");
  }
  const scope = normalizeScope(q.get("scope"));
  return {
    clientId,
    clientName: client.name,
    redirectUri,
    codeChallenge,
    scope,
    state: q.get("state"),
    resource: q.get("resource"),
  };
}

/** Everything collapses to "read" — the only scope this server offers. */
export function normalizeScope(raw: string | null | undefined): string {
  const asked = (raw ?? "").split(/\s+/).filter(Boolean);
  const unknown = asked.filter((s) => !(OAUTH_SCOPES as readonly string[]).includes(s));
  if (unknown.length) throw new OAuthError("invalid_scope", `Unknown scope: ${unknown.join(" ")}`);
  return "read";
}

export async function issueCode(userId: string, p: AuthorizeParams): Promise<string> {
  const code = "vcode_" + random(32);
  await db().insert(schema.oauthCodes).values({
    codeHash: sha256(code),
    clientId: p.clientId,
    userId,
    redirectUri: p.redirectUri,
    codeChallenge: p.codeChallenge,
    scope: p.scope,
    resource: p.resource,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  return code;
}

// ── Tokens ─────────────────────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

function mintPair() {
  const access = ACCESS_TOKEN_PREFIX + random(32);
  const refresh = REFRESH_TOKEN_PREFIX + random(32);
  return {
    access,
    refresh,
    accessHash: sha256(access),
    refreshHash: sha256(refresh),
    accessExpiresAt: new Date(Date.now() + ACCESS_TTL_MS),
    refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  };
}

const pkceMatches = (verifier: string, challenge: string) =>
  safeEqual(createHash("sha256").update(verifier).digest("base64url"), challenge);

/** authorization_code grant: one-shot code + PKCE verifier → token pair. */
export async function exchangeCode(
  client: { id: string },
  body: URLSearchParams,
): Promise<TokenResponse> {
  const code = body.get("code") ?? "";
  const verifier = body.get("code_verifier") ?? "";
  const redirectUri = body.get("redirect_uri") ?? "";
  if (!code || !verifier) {
    throw new OAuthError("invalid_request", "code and code_verifier are required.");
  }
  const [row] = await db()
    .select()
    .from(schema.oauthCodes)
    .where(eq(schema.oauthCodes.codeHash, sha256(code)))
    .limit(1);
  if (!row || row.clientId !== client.id) {
    throw new OAuthError("invalid_grant", "Unknown authorization code.");
  }
  if (row.usedAt || row.expiresAt.getTime() < Date.now()) {
    throw new OAuthError("invalid_grant", "Authorization code expired or already used.");
  }
  if (redirectUri && redirectUri !== row.redirectUri) {
    throw new OAuthError("invalid_grant", "redirect_uri mismatch.");
  }
  if (!pkceMatches(verifier, row.codeChallenge)) {
    throw new OAuthError("invalid_grant", "PKCE verification failed.");
  }
  // Burn the code first so a replayed request can never mint a second pair.
  const burned = await db()
    .update(schema.oauthCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.oauthCodes.id, row.id), isNull(schema.oauthCodes.usedAt)))
    .returning({ id: schema.oauthCodes.id });
  if (burned.length === 0) {
    throw new OAuthError("invalid_grant", "Authorization code already used.");
  }
  const pair = mintPair();
  await db().insert(schema.oauthTokens).values({
    clientId: client.id,
    userId: row.userId,
    accessHash: pair.accessHash,
    refreshHash: pair.refreshHash,
    scope: row.scope,
    accessExpiresAt: pair.accessExpiresAt,
    refreshExpiresAt: pair.refreshExpiresAt,
  });
  return {
    access_token: pair.access,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_MS / 1000,
    refresh_token: pair.refresh,
    scope: row.scope,
  };
}

/** refresh_token grant with rotation: the old pair stops working. */
export async function refreshTokens(
  client: { id: string },
  body: URLSearchParams,
): Promise<TokenResponse> {
  const refresh = body.get("refresh_token") ?? "";
  if (!refresh) throw new OAuthError("invalid_request", "refresh_token is required.");
  const [row] = await db()
    .select()
    .from(schema.oauthTokens)
    .where(eq(schema.oauthTokens.refreshHash, sha256(refresh)))
    .limit(1);
  if (!row || row.clientId !== client.id || row.revokedAt) {
    throw new OAuthError("invalid_grant", "Unknown or revoked refresh token.");
  }
  if (row.refreshExpiresAt.getTime() < Date.now()) {
    throw new OAuthError("invalid_grant", "Refresh token expired. Sign in again.");
  }
  const pair = mintPair();
  const rotated = await db()
    .update(schema.oauthTokens)
    .set({
      accessHash: pair.accessHash,
      refreshHash: pair.refreshHash,
      accessExpiresAt: pair.accessExpiresAt,
      refreshExpiresAt: pair.refreshExpiresAt,
    })
    // Guard on the old hash so two concurrent refreshes can't both win.
    .where(and(eq(schema.oauthTokens.id, row.id), eq(schema.oauthTokens.refreshHash, row.refreshHash)))
    .returning({ id: schema.oauthTokens.id });
  if (rotated.length === 0) {
    throw new OAuthError("invalid_grant", "Refresh token already rotated.");
  }
  return {
    access_token: pair.access,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_MS / 1000,
    refresh_token: pair.refresh,
    scope: row.scope,
  };
}

/** RFC 7009: revoke by access or refresh token. Unknown tokens succeed silently. */
export async function revokeToken(client: { id: string }, token: string) {
  const h = sha256(token);
  await db()
    .update(schema.oauthTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.oauthTokens.clientId, client.id),
        isNull(schema.oauthTokens.revokedAt),
        token.startsWith(REFRESH_TOKEN_PREFIX)
          ? eq(schema.oauthTokens.refreshHash, h)
          : eq(schema.oauthTokens.accessHash, h),
      ),
    );
}

export interface OAuthPrincipal {
  tokenId: string;
  clientId: string;
  clientName: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  scope: string;
}

/** Resolves a bearer access token to its user, or null when invalid/expired. */
export async function resolveAccessToken(token: string): Promise<OAuthPrincipal | null> {
  if (!token.startsWith(ACCESS_TOKEN_PREFIX)) return null;
  const [row] = await db()
    .select({
      tokenId: schema.oauthTokens.id,
      clientId: schema.oauthTokens.clientId,
      clientName: schema.oauthClients.name,
      scope: schema.oauthTokens.scope,
      userId: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.users.role,
    })
    .from(schema.oauthTokens)
    .innerJoin(schema.users, eq(schema.users.id, schema.oauthTokens.userId))
    .innerJoin(schema.oauthClients, eq(schema.oauthClients.id, schema.oauthTokens.clientId))
    .where(
      and(
        eq(schema.oauthTokens.accessHash, sha256(token)),
        isNull(schema.oauthTokens.revokedAt),
        gt(schema.oauthTokens.accessExpiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) return null;
  void db()
    .update(schema.oauthTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.oauthTokens.id, row.tokenId))
    .catch(() => {});
  return { ...row, role: row.role as Role };
}

/** Apps the user has authorized (live refresh tokens), for the settings card. */
export async function listConnectedApps(userId: string) {
  return db()
    .select({
      id: schema.oauthTokens.id,
      clientName: schema.oauthClients.name,
      createdAt: schema.oauthTokens.createdAt,
      lastUsedAt: schema.oauthTokens.lastUsedAt,
      expiresAt: schema.oauthTokens.refreshExpiresAt,
    })
    .from(schema.oauthTokens)
    .innerJoin(schema.oauthClients, eq(schema.oauthClients.id, schema.oauthTokens.clientId))
    .where(
      and(
        eq(schema.oauthTokens.userId, userId),
        isNull(schema.oauthTokens.revokedAt),
        gt(schema.oauthTokens.refreshExpiresAt, new Date()),
      ),
    )
    .orderBy(desc(schema.oauthTokens.createdAt));
}

/** User-initiated disconnect from Settings. Only the owner can revoke. */
export async function revokeConnectedApp(userId: string, tokenId: string) {
  await db()
    .update(schema.oauthTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.oauthTokens.id, tokenId), eq(schema.oauthTokens.userId, userId)));
}

/** JSON error body per RFC 6749 §5.2, with CORS so browser clients see it. */
export function oauthErrorResponse(e: unknown) {
  const err = e instanceof OAuthError ? e : new OAuthError("server_error", "Unexpected error.", 500);
  if (!(e instanceof OAuthError)) console.error("[oauth]", e);
  return Response.json(
    { error: err.code, error_description: err.message },
    { status: err.status, headers: { ...CORS_HEADERS, "cache-control": "no-store" } },
  );
}

/** MCP clients running in a browser (inspector, web IDEs) need CORS on every OAuth surface. */
export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
  "access-control-max-age": "86400",
};

export const preflight = () => new Response(null, { status: 204, headers: CORS_HEADERS });

/** Adds CORS + no-store to an existing Response without touching its body. */
export function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  headers.set("cache-control", "no-store");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
