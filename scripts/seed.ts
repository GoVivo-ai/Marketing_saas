/**
 * Seeds the database with Vivo's real workspaces and the initial admin user.
 * Idempotent: safe to re-run (upserts by unique keys).
 *
 *   npm run db:seed
 */
import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db";

if (!process.env.DATABASE_URL) {
  process.loadEnvFile(".env.local");
}

const WORKSPACES = [
  { name: "Alexia Transport", slug: "alexia", industry: "Student Transportation", accentColor: "#6366f1" },
  { name: "FTS", slug: "fts", industry: "Logistics", accentColor: "#10b981" },
  { name: "Vectora", slug: "vectora", industry: "Professional Services", accentColor: "#f59e0b" },
];

const ADMINS = [
  { name: "Victor Sandoval", email: "victor@govivo.ai" },
];

async function main() {
  for (const ws of WORKSPACES) {
    await db()
      .insert(schema.workspaces)
      .values(ws)
      .onConflictDoUpdate({
        target: schema.workspaces.slug,
        set: { name: ws.name, industry: ws.industry, accentColor: ws.accentColor },
      });
    console.log(`✓ workspace: ${ws.slug}`);
  }

  for (const admin of ADMINS) {
    const [existing] = await db()
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, admin.email))
      .limit(1);

    if (existing) {
      console.log(`✓ user exists, skipped: ${admin.email}`);
      continue;
    }

    const password = randomBytes(9).toString("base64url");
    await db().insert(schema.users).values({
      name: admin.name,
      email: admin.email,
      passwordHash: await hash(password, 12),
      role: "agency_admin",
    });
    console.log(`✓ user created: ${admin.email}`);
    console.log(`  temporary password (save it now, it is not stored): ${password}`);
  }

  console.log("Seed complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
