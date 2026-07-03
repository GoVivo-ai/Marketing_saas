import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, schema, isDatabaseConfigured } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

// Valid bcrypt hash of a throwaway string. Compared against when the email is
// unknown so login takes the same time whether or not the account exists
// (otherwise response timing leaks which emails are registered).
const DUMMY_HASH = "$2b$12$k73nAN.OKqyxVf4H6Czj0uOLQaiWYxuRZ3mki/uyScS5kOTrmkpEa";

// How often a live session re-checks its user against the DB (see jwt below).
const REVALIDATE_MS = 60_000;

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 },
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [
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
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role ?? "client";
        token.id = user.id;
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
