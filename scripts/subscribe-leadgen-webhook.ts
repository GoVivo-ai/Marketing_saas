/**
 * Subscribes every Facebook page reachable with each active Meta connection's
 * token to the app's `leadgen` webhook, so Meta notifies the app in real time
 * when a lead submits a form.
 *
 * Prerequisites (Meta App Dashboard):
 *   1. Webhooks → Page → subscribe the `leadgen` field with
 *      callback https://<app-domain>/api/meta/webhook and the same verify
 *      token as the META_WEBHOOK_VERIFY_TOKEN env var.
 *   2. META_APP_SECRET env var = Settings → Basic → App Secret.
 *
 * Run: npx tsx scripts/subscribe-leadgen-webhook.ts
 */
process.loadEnvFile(".env.local");

import postgres from "postgres";
import { createDecipheriv } from "node:crypto";

const GRAPH = "https://graph.facebook.com/v21.0";

// Mirrors src/lib/crypto.ts (decryptSecret) without importing Next-bound code:
// payload is base64(iv).base64(authTag).base64(ciphertext), AES-256-GCM.
function decryptSecret(payload: string): string {
  const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY!, "base64");
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const conns = await sql`
    SELECT c.id, c.access_token_enc, w.name AS workspace
    FROM connections c JOIN workspaces w ON w.id = c.workspace_id
    WHERE c.status = 'active' AND c.platform = 'meta'`;

  for (const conn of conns) {
    if (!conn.access_token_enc) {
      console.log(`- ${conn.workspace}: no token stored, skipping`);
      continue;
    }
    const token = decryptSecret(conn.access_token_enc);
    // Pages this user token can manage, each with its own page token.
    const res = await fetch(
      `${GRAPH}/me/accounts?fields=id,name,access_token&limit=100&access_token=${encodeURIComponent(token)}`,
    );
    const pages = (await res.json()) as {
      data?: Array<{ id: string; name: string; access_token: string }>;
      error?: { message: string };
    };
    if (pages.error) {
      console.log(`- ${conn.workspace}: ${pages.error.message}`);
      continue;
    }
    for (const page of pages.data ?? []) {
      const sub = await fetch(`${GRAPH}/${page.id}/subscribed_apps`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          subscribed_fields: "leadgen",
          access_token: page.access_token,
        }),
      });
      const out = (await sub.json()) as { success?: boolean; error?: { message: string } };
      console.log(
        `- ${conn.workspace} · page "${page.name}" (${page.id}): ` +
          (out.success ? "subscribed ✓" : out.error?.message ?? JSON.stringify(out)),
      );
    }
  }
  await sql.end();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
