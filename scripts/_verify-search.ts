process.loadEnvFile(".env.local");
import postgres from "postgres";
const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  for (const q of ["Mdeku37@gmail.com", "mdeku37", "(323) 961-0026", "3239610026", "Jovanny"]) {
    const digits = q.replace(/\D/g, "");
    const rows = await sql`
      SELECT l.name, s.name AS stage FROM leads l LEFT JOIN stages s ON s.id = l.stage_id
      WHERE l.workspace_id = ${WS} AND l.stage_id IS NOT NULL AND (
        l.name ILIKE ${"%" + q + "%"} OR l.email ILIKE ${"%" + q + "%"}
        OR (${digits.length >= 4} AND regexp_replace(coalesce(l.phone,''), '\D', '', 'g') LIKE ${"%" + digits + "%"}))`;
    console.log(`"${q}" → ${rows.length} resultado(s): ${rows.map(r => `${r.name} [${r.stage}]`).join(", ") || "—"}`);
  }
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
