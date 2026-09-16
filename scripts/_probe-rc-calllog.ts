/** Pulls Juliana's RC call log for 2026-09-03 straight from the API to see what the sync misses. */
process.loadEnvFile(".env.local");
async function main() {
  const { fetchCallLog } = await import("../src/lib/integrations/ringcentral");
  const userId = "8846b97a-71ed-44c4-93cc-589d78dad0b7";
  const recs = await fetchCallLog(userId, { dateFrom: new Date("2026-09-03T07:00:00Z"), dateTo: new Date("2026-09-04T07:00:00Z") });
  const out = recs.filter((r) => r.direction === "Outbound");
  console.log("api total", recs.length, "outbound", out.length, "distinct ids", new Set(recs.map((r) => r.id)).size);
  const want = ["5625397985", "6506139400", "5616476541", "2095706616", "3106135048", "4242661500", "4083730603", "3235579816"];
  for (const r of out) {
    const k = (r.to ?? "").replace(/\D/g, "").slice(-10);
    if (want.includes(k)) console.log(r.startTime.toISOString(), k, r.durationSec + "s", r.result, r.id);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

export {};
