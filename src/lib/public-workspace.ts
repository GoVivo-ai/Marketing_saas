import { eq } from "drizzle-orm";
import { db, schema, isDatabaseConfigured } from "@/lib/db";

/** Workspace branding needed by the public form pages (full + embed). */
export async function getPublicWorkspace(slug: string) {
  if (!isDatabaseConfigured()) return null;
  const [ws] = await db()
    .select({
      name: schema.workspaces.name,
      slug: schema.workspaces.slug,
      logoUrl: schema.workspaces.logoUrl,
      accentColor: schema.workspaces.accentColor,
    })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.slug, slug))
    .limit(1);
  return ws ?? null;
}
