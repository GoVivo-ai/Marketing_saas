import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ingestScheduleCsv } from "@/lib/dispatch-schedule";

export const maxDuration = 300;

const ALEXYAH_WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63";

/**
 * Drop-in replacement for the dispatch bot's /upload-schedule: the office
 * PC's everdriven-sync script POSTs the "all runs" CSV here (same multipart
 * contract — `password` + `file`), the platform ingests it WITH history and,
 * when BOT_UPLOAD_URL is set, forwards the identical upload to the bot so
 * its Google Sheet and SMS reminders keep working untouched.
 *
 * Switching the PC over is just: UPLOAD_URL=https://<platform-domain>
 * (password stays the same — set DISPATCH_UPLOAD_PASSWORD to match).
 */

function passwordOk(given: string): boolean {
  const secret = process.env.DISPATCH_UPLOAD_PASSWORD;
  if (!secret) return false; // fail closed until configured
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

const FORM_HTML = `<!doctype html><html><body style="font-family:sans-serif;max-width:26rem;margin:3rem auto">
<h2>Upload EverDriven schedule</h2>
<form method="post" enctype="multipart/form-data" style="display:grid;gap:.75rem">
  <label>Password<br><input type="password" name="password" required></label>
  <label>CSV file<br><input type="file" name="file" accept=".csv,text/csv" required></label>
  <button type="submit">Upload</button>
</form>
{msg}
</body></html>`;

const html = (msg: string, status = 200) =>
  new NextResponse(FORM_HTML.replace("{msg}", msg), {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

export async function GET() {
  return html("");
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const file = form.get("file");
  if (!passwordOk(password)) {
    return html("<p>❌ Wrong password.</p>", 401);
  }
  if (!(file instanceof File)) {
    return html("<p>❌ Missing CSV file.</p>", 400);
  }

  const csvText = await file.text();
  const result = await ingestScheduleCsv(ALEXYAH_WS, csvText);
  if (result.parsed === 0) {
    return html(
      "<p>❌ No rows parsed. Make sure the CSV has Date, Start, Driver Name, Status.</p>",
      422,
    );
  }

  // Keep the bot alive during the transition: relay the identical upload.
  let forwarded = "";
  const botUrl = process.env.BOT_UPLOAD_URL;
  if (botUrl) {
    try {
      const relay = new FormData();
      relay.set("password", password);
      relay.set("file", new Blob([csvText], { type: "text/csv" }), file.name);
      const res = await fetch(`${botUrl.replace(/\/$/, "")}/upload-schedule`, {
        method: "POST",
        body: relay,
      });
      forwarded = res.ok
        ? "<p>↪️ Forwarded to the dispatch bot.</p>"
        : `<p>⚠️ Bot forward failed: HTTP ${res.status}.</p>`;
    } catch (err) {
      forwarded = `<p>⚠️ Bot forward failed: ${err instanceof Error ? err.message : "error"}.</p>`;
    }
  }

  return html(
    `<p>✅ Ingested ${result.upserted} trips (${result.skipped} skipped).</p>${forwarded}`,
  );
}
