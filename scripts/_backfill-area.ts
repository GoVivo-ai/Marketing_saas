/** Backfill the sheet's Area (advertisement area) into imported manual leads' formData. */
process.loadEnvFile(".env.local");
import { readFileSync } from "node:fs";
import postgres from "postgres";

const SP = "/private/tmp/claude-501/-Volumes-M2-SSD-Developer-Marketing-saas/061092ff-a03b-4d5f-b1aa-11a5b1b56316/scratchpad";
const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const areas: Record<string, string> = JSON.parse(readFileSync(`${SP}/areas.json`, "utf8"));
  const rows = Object.entries(areas).map(([phone, area]) => ({ phone: `+1${phone}`, area }));
  let updated = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const res = await sql`
      UPDATE leads l SET form_data = jsonb_build_object('advertisement_area', v.area)
      FROM (VALUES ${sql(chunk.map((c) => [c.phone, c.area]))}) AS v(phone, area)
      WHERE l.workspace_id = ${WS} AND l.platform = 'manual'
        AND l.form_data IS NULL AND l.phone = v.phone
    `;
    updated += res.count;
  }
  console.log("manual leads updated with advertisement_area:", updated);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
