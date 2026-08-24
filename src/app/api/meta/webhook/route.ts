import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { eq, gte } from "drizzle-orm";
import { db, schema, isDatabaseConfigured } from "@/lib/db";
import { getAllMetaAppSecrets } from "@/lib/settings";
import { syncConnection } from "@/lib/sync";

export const maxDuration = 300;

/**
 * Meta leadgen webhook — real-time lead delivery. Meta calls this within
 * seconds of a form submission; we react by syncing the active Meta
 * connections, which reuses the whole ingest pipeline (attribution, geocode,
 * AI scoring, score automation) and is idempotent via the lead's external id.
 *
 * Setup (per client's Meta App Dashboard → Webhooks → Page):
 *   Callback URL: https://<app-domain>/api/meta/webhook
 *   Verify token: META_WEBHOOK_VERIFY_TOKEN (any secret string, set in both)
 *   Field:        leadgen
 * The app secret for signature validation is per client: Settings →
 * Connections → Meta app (stored encrypted on the workspace; env
 * META_APP_SECRET remains as a fallback). Each page must also be subscribed
 * to the app (scripts/subscribe-leadgen-webhook.ts does it for every page
 * reachable by the stored connection tokens).
 */

/** GET — Meta's one-time subscription verification handshake. */
export async function GET(req: NextRequest) {
  const token = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  const sp = req.nextUrl.searchParams;
  if (sp.get("hub.mode") === "subscribe" && sp.get("hub.verify_token") === token) {
    return new Response(sp.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

/**
 * Constant-time check of Meta's X-Hub-Signature-256 over the raw body. Each
 * client workspace has its own Meta app (its own secret, stored in Settings),
 * and Meta doesn't say which app is calling — so the signature is accepted if
 * it matches ANY configured secret.
 */
function signatureValid(raw: string, header: string | null, secrets: string[]): boolean {
  const got = Buffer.from(header ?? "");
  return secrets.some((secret) => {
    const expected = Buffer.from(
      "sha256=" + createHmac("sha256", secret).update(raw).digest("hex"),
    );
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

/** Ignore notifications while a sync started this recently is in flight. */
const DEBOUNCE_MS = 45_000;

/** POST — a leadgen event: pull fresh leads for every active Meta connection. */
export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const secrets = await getAllMetaAppSecrets();
  if (!secrets.length) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  const raw = await req.text();
  if (!signatureValid(raw, req.headers.get("x-hub-signature-256"), secrets)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  let body: {
    object?: string;
    entry?: Array<{ changes?: Array<{ field?: string }> }>;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  }
  const isLeadgen =
    body.object === "page" &&
    (body.entry ?? []).some((e) =>
      (e.changes ?? []).some((c) => c.field === "leadgen"),
    );
  // Acknowledge everything else so Meta doesn't retry/disable the subscription.
  if (!isLeadgen) return NextResponse.json({ ok: true, skipped: "not leadgen" });

  const activeConnections = await db()
    .select({ id: schema.connections.id })
    .from(schema.connections)
    .where(eq(schema.connections.status, "active"));

  // Leads often arrive in bursts (several submissions in a minute) — one sync
  // already picks them all up, so skip connections synced moments ago.
  const recent = activeConnections.length
    ? await db()
        .select({ connectionId: schema.syncRuns.connectionId })
        .from(schema.syncRuns)
        .where(
          gte(schema.syncRuns.startedAt, new Date(Date.now() - DEBOUNCE_MS)),
        )
    : [];
  const busy = new Set(recent.map((r) => r.connectionId));
  const toSync = activeConnections.filter((c) => !busy.has(c.id));

  const results = [];
  for (const conn of toSync) {
    const [run] = await db()
      .insert(schema.syncRuns)
      .values({ connectionId: conn.id })
      .returning();
    try {
      // A short window is all a just-submitted lead needs; leadsOnly skips
      // campaigns/metrics/ad-set refresh so the lead lands fast.
      const stats = await syncConnection(conn.id, { days: 2, leadsOnly: true });
      await db()
        .update(schema.syncRuns)
        .set({ status: "success", finishedAt: new Date(), stats })
        .where(eq(schema.syncRuns.id, run.id));
      results.push({ connection: conn.id, status: "success", leads: stats.leads });
    } catch (err) {
      await db()
        .update(schema.syncRuns)
        .set({
          status: "failed",
          finishedAt: new Date(),
          error: err instanceof Error ? err.message : String(err),
        })
        .where(eq(schema.syncRuns.id, run.id));
      results.push({ connection: conn.id, status: "failed" });
    }
  }
  return NextResponse.json({ ok: true, synced: results, debounced: busy.size });
}
