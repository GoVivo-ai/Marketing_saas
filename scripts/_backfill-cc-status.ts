/**
 * Derives leads.cc_status for leads sitting in the Contractor Compliance
 * stage, from the latest "Profile created - X" note/disposition each lead
 * has. No signal → 'activated'. Dry-run by default; `--apply` writes.
 */
process.loadEnvFile(".env.local");
import postgres from "postgres";
const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63";
const CC = "1a88f4cc-40c8-4deb-9cd2-07e67ed068e3";
const APPLY = process.argv.includes("--apply");

const RULES: [RegExp, string][] = [
  [/abandon/i, "abandoned"],
  [/completing a1s|completed.{0,10}a1s/i, "completing_a1s"],
  [/next steps? expla/i, "next_steps_explained"],
];

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const leads = await sql`
    SELECT l.id, l.name,
      (SELECT e.payload::text FROM lead_events e
       WHERE e.lead_id = l.id
         AND e.payload::text ~* '(abandon|completing a1s|next steps? expla)'
       ORDER BY e.created_at DESC LIMIT 1) AS signal
    FROM leads l
    WHERE l.workspace_id = ${WS} AND l.stage_id = ${CC} AND l.cc_status IS NULL`;
  const buckets: Record<string, string[]> = {};
  for (const l of leads) {
    let status = "activated";
    if (l.signal) for (const [re, st] of RULES) if (re.test(l.signal)) { status = st; break; }
    (buckets[status] ??= []).push(l.id);
  }
  console.log(`${APPLY ? "APLICANDO" : "DRY-RUN"} — leads en CC sin cc_status: ${leads.length}`);
  for (const [st, ids] of Object.entries(buckets)) console.log(`  ${st}: ${ids.length}`);
  if (!APPLY) { console.log("(vuelve a correr con --apply)"); await sql.end(); return; }
  for (const [st, ids] of Object.entries(buckets))
    await sql`UPDATE leads SET cc_status = ${st} WHERE id = ANY(${ids})`;
  console.log("Listo.");
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
