import { isDatabaseConfigured } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import {
  authenticateClient,
  exchangeCode,
  refreshTokens,
  oauthErrorResponse,
  OAuthError,
  CORS_HEADERS,
  preflight,
} from "@/lib/oauth";

/** RFC 6749 token endpoint: authorization_code (PKCE) and refresh_token grants. */
export const dynamic = "force-dynamic";

/** Accepts the standard form encoding and JSON, which some clients send. */
async function readBody(request: Request): Promise<URLSearchParams> {
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const j = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return new URLSearchParams(
      Object.entries(j).filter(([, v]) => typeof v === "string") as [string, string][],
    );
  }
  return new URLSearchParams(await request.text());
}

export async function POST(request: Request) {
  try {
    if (!isDatabaseConfigured()) throw new OAuthError("server_error", "Database not configured.", 503);
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!rateLimit(`oauth-token:${ip}`, 60, 15 * 60_000)) {
      throw new OAuthError("invalid_request", "Too many requests.", 429);
    }
    const body = await readBody(request);
    const client = await authenticateClient(request, body);
    const grant = body.get("grant_type");
    const tokens =
      grant === "authorization_code"
        ? await exchangeCode(client, body)
        : grant === "refresh_token"
          ? await refreshTokens(client, body)
          : (() => {
              throw new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
            })();
    return Response.json(tokens, {
      headers: { ...CORS_HEADERS, "cache-control": "no-store", pragma: "no-cache" },
    });
  } catch (e) {
    return oauthErrorResponse(e);
  }
}

export const OPTIONS = preflight;
