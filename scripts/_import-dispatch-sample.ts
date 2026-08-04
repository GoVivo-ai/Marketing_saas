/**
 * One-off: load the parsed dispatch sample JSON (drivers/covers/interactions)
 * into the AlexYah workspace. Re-runnable — wipes and reloads the workspace's
 * dispatch rows each time (sample-data phase only).
 *
 * Usage: npx tsx scripts/_import-dispatch-sample.ts <dir-with-json>
 */
process.loadEnvFile(".env.local");
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db";

const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63"; // AlexYah
const dir = process.argv[2];
if (!dir) {
  console.error("usage: tsx scripts/_import-dispatch-sample.ts <dir>");
  process.exit(1);
}

const read = (f: string) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
const date = (s: string | null) => (s ? new Date(s) : null);

async function main() {
  const drivers = read("drivers.json");
  const covers = read("covers.json");
  const interactions = read("interactions.json");

  await db().delete(schema.dispatchInteractions).where(eq(schema.dispatchInteractions.workspaceId, WS));
  await db().delete(schema.dispatchCovers).where(eq(schema.dispatchCovers.workspaceId, WS));
  await db().delete(schema.dispatchDrivers).where(eq(schema.dispatchDrivers.workspaceId, WS));

  const idByKey = new Map<string, string>();
  for (const d of drivers) {
    const [row] = await db()
      .insert(schema.dispatchDrivers)
      .values({
        workspaceId: WS,
        mdd: d.mdd,
        name: d.name,
        normName: d.normName,
        state: d.state,
        area: d.area,
        address: d.address,
        status: d.status,
        hasRoutes: d.hasRoutes,
        phone: d.phone,
        email: d.email,
        emergencyName: d.emergencyName,
        emergencyPhone: d.emergencyPhone,
        emergencyRelation: d.emergencyRelation,
        camera: d.camera,
        carSeats: d.carSeats,
        boosterSeats: d.boosterSeats,
      })
      .returning({ id: schema.dispatchDrivers.id });
    idByKey.set(d.normName, row.id);
  }
  console.log("drivers inserted:", idByKey.size);

  let n = 0;
  for (const c of covers) {
    await db().insert(schema.dispatchCovers).values({
      workspaceId: WS,
      date: date(c.date),
      rescueDate: date(c.rescueDate),
      company: c.company,
      area: c.area,
      reason: c.reason,
      driverId: c.driverKey ? idByKey.get(c.driverKey) ?? null : null,
      driverName: c.driverName,
      rescueDriverId: c.rescueKey ? idByKey.get(c.rescueKey) ?? null : null,
      rescueName: c.rescueName,
      payment: c.payment,
      comments: c.comments,
    });
    n++;
  }
  console.log("covers inserted:", n);

  n = 0;
  for (const i of interactions) {
    await db().insert(schema.dispatchInteractions).values({
      workspaceId: WS,
      driverId: i.driverKey ? idByKey.get(i.driverKey) ?? null : null,
      driverName: i.driverName,
      priority: i.priority,
      status: i.status,
      description: i.description,
      classification: i.classification,
      category: i.category,
      subCategories: i.subCategories,
      assignedTo: i.assignedTo,
      createdBy: i.createdBy,
      modifiedBy: i.modifiedBy,
      spCreatedAt: date(i.spCreatedAt),
      spModifiedAt: date(i.spModifiedAt),
      resolvedAt: date(i.resolvedAt),
    });
    n++;
  }
  console.log("interactions inserted:", n);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
