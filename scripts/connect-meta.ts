/**
 * Registers (or refreshes) a Meta connection for a workspace, storing the
 * token from META_ACCESS_TOKEN encrypted at rest.
 *
 *   npx tsx scripts/connect-meta.ts <workspace-slug> <act_xxxx> [account name]
 */
process.loadEnvFile(".env.local");

import { and, eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { encryptSecret } from "../src/lib/crypto";

async function main() {
  const [slug, accountId, ...nameParts] = process.argv.slice(2);
  if (!slug || !accountId?.startsWith("act_")) {
    console.error("Usage: npx tsx scripts/connect-meta.ts <workspace-slug> <act_xxxx> [account name]");
    process.exit(1);
  }
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    console.error("META_ACCESS_TOKEN is not set in .env.local");
    process.exit(1);
  }

  const [ws] = await db()
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.slug, slug))
    .limit(1);
  if (!ws) {
    console.error(`Workspace not found: ${slug}`);
    process.exit(1);
  }

  const accessTokenEnc = encryptSecret(token);
  const accountName = nameParts.join(" ") || null;

  const [existing] = await db()
    .select({ id: schema.connections.id })
    .from(schema.connections)
    .where(
      and(
        eq(schema.connections.workspaceId, ws.id),
        eq(schema.connections.platform, "meta"),
        eq(schema.connections.accountId, accountId),
      ),
    )
    .limit(1);

  if (existing) {
    await db()
      .update(schema.connections)
      .set({ accessTokenEnc, accountName, status: "active" })
      .where(eq(schema.connections.id, existing.id));
    console.log(`✓ refreshed connection ${existing.id} (${slug} → ${accountId})`);
  } else {
    const [created] = await db()
      .insert(schema.connections)
      .values({
        workspaceId: ws.id,
        platform: "meta",
        accountId,
        accountName,
        accessTokenEnc,
      })
      .returning({ id: schema.connections.id });
    console.log(`✓ created connection ${created.id} (${slug} → ${accountId})`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
