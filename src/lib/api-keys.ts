import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { ACCESS_TOKEN_PREFIX, resolveAccessToken } from "@/lib/oauth";

/** Tokens look like `vivo_<40 hex>`; the prefix makes them easy to spot in logs. */
const TOKEN_PREFIX = "vivo_";
/** How many keys one user may hold at once (revoked ones don't count). */
export const MAX_ACTIVE_KEYS = 5;

export const hashApiKey = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/** Fresh random token + what we persist for it. The plaintext is shown once. */
export function generateApiKey() {
  const token = TOKEN_PREFIX + randomBytes(20).toString("hex");
  return {
    token,
    keyHash: hashApiKey(token),
    // "vivo_1a2b3c" — enough to tell keys apart, useless to guess the rest.
    keyPrefix: token.slice(0, TOKEN_PREFIX.length + 6),
  };
}

export interface ApiKeyPrincipal {
  keyId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
}

/**
 * Resolves a bearer token to its owner, or null when unknown/revoked.
 * Touches last_used_at without awaiting so auth never waits on the write.
 */
export async function resolveApiKey(token: string): Promise<ApiKeyPrincipal | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const [row] = await db()
    .select({
      keyId: schema.apiKeys.id,
      userId: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.users.role,
    })
    .from(schema.apiKeys)
    .innerJoin(schema.users, eq(schema.users.id, schema.apiKeys.userId))
    .where(
      and(eq(schema.apiKeys.keyHash, hashApiKey(token)), isNull(schema.apiKeys.revokedAt)),
    )
    .limit(1);
  if (!row) return null;
  void db()
    .update(schema.apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.apiKeys.id, row.keyId))
    .catch(() => {});
  return { ...row, role: row.role as Role };
}

/** The user's keys for the settings card (never the hash). */
export async function listApiKeys(userId: string) {
  return db()
    .select({
      id: schema.apiKeys.id,
      name: schema.apiKeys.name,
      keyPrefix: schema.apiKeys.keyPrefix,
      lastUsedAt: schema.apiKeys.lastUsedAt,
      createdAt: schema.apiKeys.createdAt,
    })
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.userId, userId), isNull(schema.apiKeys.revokedAt)))
    .orderBy(schema.apiKeys.createdAt);
}

/** Who is calling the MCP endpoint: an API key owner or an OAuth-authorized user. */
export interface McpPrincipal extends ApiKeyPrincipal {
  /** "api_key" for personal tokens, "oauth" for consent-flow tokens. */
  via: "api_key" | "oauth";
  /** OAuth client name (e.g. "Claude"), for logs. */
  clientName?: string;
}

/**
 * Dispatches on the token prefix: `vivo_at_…` is an OAuth access token,
 * plain `vivo_…` a personal API key. Both resolve to the same shape so the
 * MCP server never cares how the user authenticated.
 */
export async function resolveBearer(token: string): Promise<McpPrincipal | null> {
  if (token.startsWith(ACCESS_TOKEN_PREFIX)) {
    const p = await resolveAccessToken(token);
    return p
      ? { keyId: p.tokenId, userId: p.userId, name: p.name, email: p.email, role: p.role, via: "oauth", clientName: p.clientName }
      : null;
  }
  const k = await resolveApiKey(token);
  return k ? { ...k, via: "api_key" } : null;
}
