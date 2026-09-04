import { isDatabaseConfigured } from "@/lib/db";
import { authenticateClient, revokeToken, oauthErrorResponse, OAuthError, CORS_HEADERS, preflight } from "@/lib/oauth";

/** RFC 7009 token revocation. */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!isDatabaseConfigured()) throw new OAuthError("server_error", "Database not configured.", 503);
    const body = new URLSearchParams(await request.text());
    const client = await authenticateClient(request, body);
    const token = body.get("token");
    if (token) await revokeToken(client, token);
    return new Response(null, { status: 200, headers: { ...CORS_HEADERS, "cache-control": "no-store" } });
  } catch (e) {
    return oauthErrorResponse(e);
  }
}

export const OPTIONS = preflight;
