/** Intenta leer el uso del día desde la API de OpenAI (requiere admin key). */
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
  const [row] = await sql`SELECT value_enc FROM app_settings WHERE key = 'openai_api_key'`;
  const apiKey = decryptSecret(row.value_enc);
  const start = Math.floor(Date.now() / 1000) - 6 * 3600;
  const res = await fetch(
    `https://api.openai.com/v1/organization/usage/completions?start_time=${start}&bucket_width=1d&group_by=model`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  const data = await res.json();
  if (data.error) { console.log("API de uso no disponible con esta key:", data.error.message?.slice(0, 120)); }
  else {
    for (const b of data.data ?? [])
      for (const r of b.results ?? [])
        console.log(`${r.model}: input=${r.input_tokens} output=${r.output_tokens} requests=${r.num_model_requests}`);
  }
  await sql.end();
}
main().catch((e)=>{console.error(e);process.exit(1);});
