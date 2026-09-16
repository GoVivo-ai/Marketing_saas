/**
 * Imports AlexYah's driver applications into the lead pipeline.
 *
 *   npx tsx scripts/sync-alexyah.ts                  # dry run
 *   npx tsx scripts/sync-alexyah.ts --write
 *   npx tsx scripts/sync-alexyah.ts --write --ws alexyah
 *
 * Dry run first: these land in the live pipeline the team works from.
 */
process.loadEnvFile(".env.local");

import { syncAlexYahApplications } from "../src/lib/alexyah-sync";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--write");
  const wsArg = args.indexOf("--ws");
  const slug = wsArg >= 0 ? args[wsArg + 1] : "alexyah";

  const s = await syncAlexYahApplications(slug, { dryRun });
  if (s.skipped) {
    console.error(`Skipped: ${s.skipped}`);
    process.exit(1);
  }

  console.log(dryRun ? "DRY RUN — nothing written\n" : "WRITING\n");
  console.table({
    "applications fetched": s.fetched,
    "would create": s.created,
    "would update": s.updated,
    "no phone and no email": s.unusable,
  });
  console.log("\nBy their hiring stage:");
  console.table(s.byStage);
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
