import { createHash } from "node:crypto";
import { decode, encode } from "next-auth/jwt";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * Keeps the mobile apps signed in past the web session's 24 hours.
 *
 * The apps authenticate exactly like the browser — the Auth.js session
 * cookie — so every server function works for them unchanged. What a phone
 * needs on top is not to ask for the password every morning: after signing
 * in, the app is handed a long-lived refresh token (kept in the device's
 * secure storage) that it trades for a fresh session cookie when the old one
 * has expired.
 *
 * The token is stateless, so revocation rides on what it carries: it stops
 * working when the user is deleted or changes their password.
 */

const REFRESH_SALT = "vivo-mobile-refresh";
const REFRESH_MAX_AGE_S = 60 * 24 * 60 * 60;
const SESSION_MAX_AGE_S = 24 * 60 * 60;

interface RefreshPayload {
  sub?: string;
  typ?: string;
  /** Fingerprint of the password hash at issue time. */
  pf?: string;
}

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

const fingerprint = (passwordHash: string | null) =>
  createHash("sha256").update(passwordHash ?? "").digest("hex").slice(0, 16);

async function findUser(id: string) {
  const [user] = await db()
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.users.role,
      passwordHash: schema.users.passwordHash,
    })
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);
  return user ?? null;
}

export async function issueRefreshToken(userId: string): Promise<string | null> {
  const user = await findUser(userId);
  if (!user) return null;
  return encode<RefreshPayload>({
    token: { sub: user.id, typ: "mobile-refresh", pf: fingerprint(user.passwordHash) },
    secret: secret(),
    salt: REFRESH_SALT,
    maxAge: REFRESH_MAX_AGE_S,
  });
}

/** The session cookie Auth.js itself would set for this request's scheme. */
export function sessionCookieName(secure: boolean): string {
  return `${secure ? "__Secure-" : ""}authjs.session-token`;
}

/**
 * Trades a refresh token for a session cookie value, or null when the token
 * is expired, forged, or no longer matches the user.
 */
export async function sessionFromRefreshToken(
  refreshToken: string,
  secure: boolean,
): Promise<{ name: string; value: string; maxAge: number } | null> {
  const payload = await decode<RefreshPayload>({
    token: refreshToken,
    secret: secret(),
    salt: REFRESH_SALT,
  }).catch(() => null);
  if (!payload?.sub || payload.typ !== "mobile-refresh") return null;
  const user = await findUser(payload.sub);
  if (!user || payload.pf !== fingerprint(user.passwordHash)) return null;

  const name = sessionCookieName(secure);
  // Same claims the jwt() callback in auth.ts writes at sign-in.
  const value = await encode({
    token: {
      sub: user.id,
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      chk: Date.now(),
    },
    secret: secret(),
    salt: name,
    maxAge: SESSION_MAX_AGE_S,
  });
  return { name, value, maxAge: SESSION_MAX_AGE_S };
}
