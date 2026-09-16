/** Creates a temporary contact priority on Alexyah, applies it, inspects, deletes it. */
process.loadEnvFile(".env.local");
async function main() {
  const { db, schema } = await import("../src/lib/db");
  const { eq, desc } = await import("drizzle-orm");
  const { applyContactPriority } = await import("../src/lib/ai/contact-priority");
  const [ws] = await db().select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.slug, "alexyah"));
  const [p] = await db().insert(schema.contactPriorities).values({
    workspaceId: ws.id, name: "TEST Redondo push", sinceDays: 30,
    prompt: "Leads in or near Redondo Beach, Torrance or the South Bay area of Los Angeles. Anyone who already has experience transporting passengers or students is a plus.",
  }).returning({ id: schema.contactPriorities.id });
  const t0 = Date.now();
  const res = await applyContactPriority(p.id);
  console.log("apply", res, `${Math.round((Date.now() - t0) / 1000)}s`);
  const top = await db().select({ boost: schema.leadPriorities.boost, reason: schema.leadPriorities.reason, name: schema.leads.name, city: schema.leads.geoCity, target: schema.adsets.cityName })
    .from(schema.leadPriorities).innerJoin(schema.leads, eq(schema.leadPriorities.leadId, schema.leads.id)).leftJoin(schema.adsets, eq(schema.leads.adsetId, schema.adsets.id))
    .where(eq(schema.leadPriorities.priorityId, p.id)).orderBy(desc(schema.leadPriorities.boost)).limit(8);
  console.table(top);
  const low = await db().select({ boost: schema.leadPriorities.boost, city: schema.leads.geoCity, target: schema.adsets.cityName })
    .from(schema.leadPriorities).innerJoin(schema.leads, eq(schema.leadPriorities.leadId, schema.leads.id)).leftJoin(schema.adsets, eq(schema.leads.adsetId, schema.adsets.id))
    .where(eq(schema.leadPriorities.priorityId, p.id)).orderBy(schema.leadPriorities.boost).limit(4);
  console.table(low);
  await db().delete(schema.contactPriorities).where(eq(schema.contactPriorities.id, p.id));
  console.log("deleted test priority");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

export {};
