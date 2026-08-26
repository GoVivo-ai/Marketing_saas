import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { compare } from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, schema, isDatabaseConfigured } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { DEMO_EMAIL } from "@/lib/demo";

// Valid bcrypt hash of a throwaway string. Compared against when the email is
// unknown so login takes the same time whether or not the account exists
// (otherwise response timing leaks which emails are registered).
const DUMMY_HASH = "$2b$12$k73nAN.OKqyxVf4H6Czj0uOLQaiWYxuRZ3mki/uyScS5kOTrmkpEa";

// How often a live session re-checks its user against the DB (see jwt below).
const REVALIDATE_MS = 60_000;

/**
 * Google SSO switches on when its OAuth credentials are configured
 * (AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET — Auth.js reads them by convention).
 * It's sign-IN only: the Google email must already exist in `users`, so SSO
 * never creates accounts and the roster stays admin-managed.
 */
export const googleSsoEnabled = Boolean(
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
);

/** DB user matching an OAuth profile's email, or null. */
async function userByEmail(email: string | null | undefined) {
  const normalized = (email ?? "").toLowerCase().trim();
  if (!normalized || !isDatabaseConfigured()) return null;
  const [user] = await db()
    .select({ id: schema.users.id, role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.email, normalized))
    .limit(1);
  return user ?? null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 },
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [
    ...(googleSsoEnabled ? [Google] : []),
    Credentials({
      name: "Email & Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").toLowerCase().trim();
        const password = String(credentials?.password ?? "");
        if (!email || !password || !isDatabaseConfigured()) return null;

        // Brake on online brute force / credential stuffing per account.
        if (!rateLimit(`login:${email}`, 10, 15 * 60_000)) return null;

        const [user] = await db()
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, email))
          .limit(1);
        if (!user?.passwordHash) {
          await compare(password, DUMMY_HASH);
          return null;
        }

        const valid = await compare(password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, name: user.name, email: user.email, role: user.role };
      },
    }),
    // Passwordless sign-in for the public demo tour (/demo). It only ever
    // resolves to the seeded demo account, so the worst an abuser gets is the
    // demo itself. Optionally gated by DEMO_ACCESS_KEY (?key= on the link).
    Credentials({
      id: "demo",
      name: "Demo",
      credentials: { key: { type: "text" } },
      async authorize(credentials) {
        if (!isDatabaseConfigured()) return null;
        const required = process.env.DEMO_ACCESS_KEY;
        if (required && String(credentials?.key ?? "") !== required) return null;
        if (!rateLimit("login:demo", 60, 15 * 60_000)) return null;
        const [user] = await db()
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, DEMO_EMAIL))
          .limit(1);
        if (!user) return null; // demo not seeded → no way in
        return { id: user.id, name: user.name, email: user.email, role: user.role };
      },
    }),
  ],
  callbacks: {
    // Google sign-in is allowed only for emails already on the roster —
    // unknown accounts bounce back to /login with error=AccessDenied.
    async signIn({ user, account }) {
      if (account?.provider !== "google") return true;
      return (await userByEmail(user.email)) !== null;
    },
    async jwt({ token, user, account }) {
      if (user) {
        if (account?.provider === "google") {
          // The OAuth profile carries Google's ids — swap in ours.
          const dbUser = await userByEmail(user.email);
          if (!dbUser) return null;
          token.id = dbUser.id;
          token.role = dbUser.role;
        } else {
          token.role = (user as { role?: string }).role ?? "client";
          token.id = user.id;
        }
        token.chk = Date.now();
        return token;
      }
      // JWTs are stateless: without this, a deleted or demoted user keeps
      // access until maxAge. Re-check the DB at most once per minute so
      // revocation takes effect promptly without a query on every request.
      const chk = typeof token.chk === "number" ? token.chk : 0;
      if (token.id && isDatabaseConfigured() && Date.now() - chk > REVALIDATE_MS) {
        const [current] = await db()
          .select({ role: schema.users.role })
          .from(schema.users)
          .where(eq(schema.users.id, String(token.id)))
          .limit(1);
        if (!current) return null; // user deleted → invalidate the session
        token.role = current.role;
        token.chk = Date.now();
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.id ?? "");
        (session.user as { role?: string }).role = String(token.role ?? "client");
      }
      return session;
    },
  },
});
