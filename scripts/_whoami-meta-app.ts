/** Identifica la app de Meta detrás de los tokens de las conexiones. */
process.loadEnvFile(".env.local");
import postgres from "postgres";
import { createDecipheriv } from "node:crypto";
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
    SELECT c.access_token_enc, w.name AS workspace FROM connections c
    JOIN workspaces w ON w.id = c.workspace_id
    WHERE c.status = 'active' AND c.platform = 'meta' AND c.access_token_enc IS NOT NULL`;
  for (const c of conns) {
    const token = decryptSecret(c.access_token_enc);
    const res = await fetch(`https://graph.facebook.com/v21.0/app?fields=id,name&access_token=${encodeURIComponent(token)}`);
    const app = await res.json();
    console.log(`${c.workspace}: app id=${app.id ?? "?"} name=${app.name ?? JSON.stringify(app.error?.message)}`);
  }
  await sql.end();
}
main().catch((e)=>{console.error(e);process.exit(1);});
