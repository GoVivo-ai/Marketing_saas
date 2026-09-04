import { isDatabaseConfigured } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { registerClient, oauthErrorResponse, OAuthError, CORS_HEADERS, preflight } from "@/lib/oauth";

/**
 * RFC 7591 Dynamic Client Registration. Open (no initial access token) so
 * claude.ai, ChatGPT and Claude Code can self-register; the registration
 * alone grants nothing — a user still has to sign in and approve.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!isDatabaseConfigured()) throw new OAuthError("server_error", "Database not configured.", 503);
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!rateLimit(`oauth-register:${ip}`, 20, 60 * 60_000)) {
      throw new OAuthError("invalid_request", "Too many registrations. Try again later.", 429);
    }
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new OAuthError("invalid_client_metadata", "Body must be JSON.");

    const c = await registerClient(body);
    return Response.json(
      {
        client_id: c.id,
        ...(c.secret ? { client_secret: c.secret, client_secret_expires_at: 0 } : {}),
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: c.name,
        redirect_uris: c.uris,
        token_endpoint_auth_method: c.method,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: "read",
      },
      { status: 201, headers: { ...CORS_HEADERS, "cache-control": "no-store" } },
    );
  } catch (e) {
    return oauthErrorResponse(e);
  }
}

export const OPTIONS = preflight;
