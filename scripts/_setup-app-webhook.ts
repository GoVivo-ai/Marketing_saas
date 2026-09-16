/**
 * Configura la suscripción de webhook a nivel APP vía Graph API (equivale a
 * App Dashboard → Webhooks → Page → leadgen). Usa el app access token
 * (app_id|app_secret) del workspace. Meta verifica el callback con el GET
 * handshake en el momento.
 */
process.loadEnvFile(".env.local");
import postgres from "postgres";
import { createDecipheriv } from "node:crypto";
const CALLBACK = "https://platform.govivo.ai/api/meta/webhook";
function decryptSecret(payload: string): string {
  const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY!, "base64");
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}
async function main() {
  const verify = process.env.META_WEBHOOK_VERIFY_TOKEN!;
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const rows = await sql`
    SELECT name, meta_app_id, meta_app_secret_enc FROM workspaces
    WHERE is_active AND meta_app_id IS NOT NULL AND meta_app_secret_enc IS NOT NULL`;
  for (const w of rows) {
    const appToken = `${w.meta_app_id}|${decryptSecret(w.meta_app_secret_enc)}`;
    const res = await fetch(`https://graph.facebook.com/v21.0/${w.meta_app_id}/subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        object: "page",
        callback_url: CALLBACK,
        fields: "leadgen",
        verify_token: verify,
        include_values: "true",
        access_token: appToken,
      }),
    });
    const out = await res.json();
    console.log(`${w.name} (app ${w.meta_app_id}):`, JSON.stringify(out));
    const check = await fetch(`https://graph.facebook.com/v21.0/${w.meta_app_id}/subscriptions?access_token=${encodeURIComponent(appToken)}`);
    console.log("  estado:", JSON.stringify(await check.json()).slice(0, 300));
  }
  await sql.end();
}
main().catch((e)=>{console.error(e);process.exit(1);});
