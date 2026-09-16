process.loadEnvFile(".env.local");
import postgres from "postgres";
import fs from "node:fs";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const csv = fs.readFileSync("/Users/victorsandoval/Downloads/Juliana Jueves 3 de Septiembre.csv", "utf8").trim().split("\n").slice(1)
    .map((l) => l.split(",")).filter((c) => c[6] === "Outbound")
    .map((c) => ({ to: c[1].replace(/\D/g, "").slice(-10), len: +c[3], at: c[5] }));
  const rows = await sql`SELECT external_id, to_number, duration_sec, start_time::text st, result FROM call_logs c JOIN users u ON u.id=c.user_id
    WHERE u.name ILIKE 'Juliana%' AND c.direction='Outbound' AND c.start_time >= '2026-09-03 07:00' AND c.start_time < '2026-09-04 07:00' ORDER BY start_time`;
  const dbKeys = rows.map((r) => ({ to: (r.to_number ?? "").replace(/\D/g, "").slice(-10), len: r.duration_sec, st: r.st, ext: r.external_id }));
  console.log("csv outbound", csv.length, "db outbound", rows.length);
  const missing = csv.filter((c) => !dbKeys.some((d) => d.to === c.to && Math.abs(d.len - c.len) <= 2));
  console.log("in CSV not in DB:", missing.length); for (const m of missing) console.log("  ", m.at, m.to, m.len + "s");
  const extra = dbKeys.filter((d) => !csv.some((c) => d.to === c.to && Math.abs(d.len - c.len) <= 2));
  console.log("in DB not in CSV:", extra.length); for (const e of extra) console.log("  ", e.st, e.to, e.len + "s", e.ext);
  await sql.end();
}
main();
