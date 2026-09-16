/**
 * Stores the AlexYah integration API key, encrypted, in app_settings.
 *
 *   npx tsx scripts/set-alexyah-key.ts <key>
 *
 * Kept out of the env so it lives with the other client secrets and can be
 * rotated without a redeploy.
 */
process.loadEnvFile(".env.local");

import { getSecretPreview, setSecret } from "../src/lib/settings";

async function main() {
  const key = process.argv[2];
  if (!key) {
    console.error("Usage: npx tsx scripts/set-alexyah-key.ts <key>");
    process.exit(1);
  }
  await setSecret("alexyah_api_key", key);
  console.log("Stored. Preview:", await getSecretPreview("alexyah_api_key"));
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
