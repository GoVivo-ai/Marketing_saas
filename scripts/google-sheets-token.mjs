/**
 * Mints a Google OAuth refresh token for the Sheets read-only scope using the
 * app's existing "Auth google" client, and stores it directly in .env.local
 * and Vercel (preview + production) — the token value is never printed.
 *
 * Run: node scripts/google-sheets-token.mjs
 * Then open the printed URL, pick the account that can read the bot's sheet,
 * and click Allow. Requires http://localhost:53682 among the OAuth client's
 * authorized redirect URIs.
 */
import { createServer } from "node:http";
import { appendFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

process.loadEnvFile(".env.local");

const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}`;
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const id = process.env.AUTH_GOOGLE_ID;
const secret = process.env.AUTH_GOOGLE_SECRET;
if (!id || !secret) {
  console.error("AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET missing in .env.local");
  process.exit(1);
}

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: id,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(404).end();
    return;
  }
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: id,
        client_secret: secret,
        redirect_uri: REDIRECT,
      }),
    });
    const data = await tokenRes.json();
    if (!data.refresh_token) throw new Error(JSON.stringify(data).slice(0, 300));

    appendFileSync(".env.local", `GOOGLE_OAUTH_REFRESH_TOKEN=${data.refresh_token}\n`);
    for (const envName of ["preview", "production"]) {
      const r = spawnSync(
        "vercel",
        ["env", "add", "GOOGLE_OAUTH_REFRESH_TOKEN", envName],
        { input: data.refresh_token, encoding: "utf8" },
      );
      console.log(
        `vercel ${envName}:`,
        r.status === 0 ? "added" : (r.stderr || "").split("\n").find(Boolean),
      );
    }
    console.log("REFRESH-TOKEN-GUARDADO (no se muestra por seguridad)");
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h2>Listo — ya puedes cerrar esta pestaña.</h2>");
  } catch (e) {
    console.error("exchange failed:", e.message);
    res.writeHead(500).end("Error — mira la terminal.");
  } finally {
    setTimeout(() => process.exit(0), 500);
  }
});
server.listen(PORT, () => {
  console.log("Abre esta URL y dale Allow:");
  console.log(authUrl);
});
