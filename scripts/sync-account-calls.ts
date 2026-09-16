/**
 * Account-level RingCentral call log sync.
 *
 *   npx tsx scripts/sync-account-calls.ts            # dry run: reports, writes nothing
 *   npx tsx scripts/sync-account-calls.ts --write    # actually mirrors into call_logs
 *   npx tsx scripts/sync-account-calls.ts --days 30  # override the window
 *
 * Dry run first, always: preview and production share one database, so the
 * extension → agent mapping has to be right before a row lands in the table
 * the Daily Calls report reads.
 */
process.loadEnvFile(".env.local");

import { syncAccountCallLogs } from "../src/lib/account-call-sync";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--write");
  const daysArg = args.indexOf("--days");
  const days = daysArg >= 0 ? Number(args[daysArg + 1]) : undefined;

  const r = await syncAccountCallLogs({ dryRun, days });

  if (r.skipped) {
    console.error(`Skipped: ${r.skipped}`);
    process.exit(1);
  }

  console.log(dryRun ? "DRY RUN — nothing written\n" : "WRITING\n");

  console.log("Extension → agent");
  console.table(
    r.extensions.map((e) => ({
      ext: e.extensionNumber ?? e.extensionId,
      ringcentral: e.rcName ?? "—",
      email: e.rcEmail ?? "—",
      agent: e.userName ?? "— UNMATCHED —",
      how: e.matchedBy,
    })),
  );

  const unmatched = r.extensions.filter((e) => !e.userId).length;
  console.log(
    `\nWindow: ${r.from?.toISOString().slice(0, 10)} → ${r.to?.toISOString().slice(0, 10)}`,
  );
  console.table({
    "calls fetched": r.fetched,
    "would create": r.created,
    "would update": r.updated,
    "dropped (no agent)": r.unmappedCalls,
    "matched to a lead": r.matchedToLeads,
    "extensions unmatched": unmatched,
  });

  if (unmatched > 0) {
    console.log(
      `\n⚠  ${unmatched} extension(s) have no agent. Their calls are skipped, not guessed.`,
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
