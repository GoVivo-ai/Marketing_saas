/**
 * Pins a RingCentral extension to a platform user by hand.
 *
 *   npx tsx scripts/map-rc-extension.ts --list
 *   npx tsx scripts/map-rc-extension.ts 12345678 juliana@govivo.ai
 *   npx tsx scripts/map-rc-extension.ts 12345678 --none
 *
 * For the extensions the matcher can't place on its own — an agent whose
 * RingCentral account uses a personal address, a shared line, a name spelled
 * differently on each side. A mapping set here is marked "manual" and the
 * automatic matcher never overwrites it.
 */
process.loadEnvFile(".env.local");

import { eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db";

async function list() {
  const rows = await db()
    .select({
      extensionId: schema.rcExtensions.extensionId,
      extensionNumber: schema.rcExtensions.extensionNumber,
      rcName: schema.rcExtensions.rcName,
      rcEmail: schema.rcExtensions.rcEmail,
      matchedBy: schema.rcExtensions.matchedBy,
      agent: schema.users.name,
    })
    .from(schema.rcExtensions)
    .leftJoin(schema.users, eq(schema.rcExtensions.userId, schema.users.id));
  if (rows.length === 0) {
    console.log("No extensions stored yet — run sync-account-calls.ts --write first.");
    return;
  }
  console.table(
    rows.map((r) => ({
      id: r.extensionId,
      ext: r.extensionNumber ?? "—",
      ringcentral: r.rcName ?? "—",
      email: r.rcEmail ?? "—",
      agent: r.agent ?? "— UNMATCHED —",
      how: r.matchedBy,
    })),
  );
}

async function main() {
  const [a, b] = process.argv.slice(2);
  if (!a || a === "--list") return list();

  const [ext] = await db()
    .select({ id: schema.rcExtensions.id, rcName: schema.rcExtensions.rcName })
    .from(schema.rcExtensions)
    .where(eq(schema.rcExtensions.extensionId, a))
    .limit(1);
  if (!ext) {
    console.error(`No extension with id ${a}. Run --list to see them.`);
    process.exit(1);
  }

  if (b === "--none") {
    await db()
      .update(schema.rcExtensions)
      .set({ userId: null, matchedBy: "manual", updatedAt: new Date() })
      .where(eq(schema.rcExtensions.id, ext.id));
    console.log(`Extension ${a} (${ext.rcName ?? "?"}) now maps to nobody.`);
    return;
  }

  if (!b) {
    console.error("Usage: map-rc-extension.ts <extensionId> <userEmail|--none>");
    process.exit(1);
  }

  const [user] = await db()
    .select({ id: schema.users.id, name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.email, b.toLowerCase().trim()))
    .limit(1);
  if (!user) {
    console.error(`No user with email ${b}.`);
    process.exit(1);
  }

  await db()
    .update(schema.rcExtensions)
    .set({ userId: user.id, matchedBy: "manual", updatedAt: new Date() })
    .where(eq(schema.rcExtensions.id, ext.id));
  console.log(
    `Extension ${a} (${ext.rcName ?? "?"}) → ${user.name}. Marked manual; the matcher will leave it alone.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
