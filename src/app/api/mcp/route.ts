import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isDatabaseConfigured } from "@/lib/db";
import { resolveBearer } from "@/lib/api-keys";
import { baseUrl, oauthEndpoints, preflight, withCors } from "@/lib/oauth";
import { createMcpServer } from "@/lib/mcp/server";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Read-only MCP endpoint (Streamable HTTP, stateless). Clients authenticate
 * either through the OAuth consent flow (claude.ai, ChatGPT, Claude Code —
 * the 401 below points them at the authorization server) or with a personal
 * API key from Settings sent as a bearer header.
 *
 * Each POST builds a fresh server + transport, so it runs fine on Vercel
 * where no two requests are guaranteed to hit the same instance.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const unauthorized = (request: Request, msg: string) =>
  withCors(
    new Response(JSON.stringify({ error: msg }), {
      status: 401,
      headers: {
        "content-type": "application/json",
        // RFC 9728: tells MCP clients where to discover the OAuth server.
        "www-authenticate": `Bearer realm="vivo-mcp", resource_metadata="${
          oauthEndpoints(baseUrl(request)).resource_metadata
        }"`,
      },
    }),
  );

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return new Response("Database not configured", { status: 503 });
  }
  const header = request.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return unauthorized(request, "Sign in via OAuth or send a personal API key from Settings → API access.");

  // Brake on token guessing: 30 failures per IP / 15 min.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(`mcp-auth:${ip}`, 30, 15 * 60_000)) {
    return new Response("Too many requests", { status: 429 });
  }
  const principal = await resolveBearer(token);
  if (!principal) return unauthorized(request, "Invalid, expired or revoked token.");

  // Per-key request budget so a runaway agent can't hammer the DB.
  if (!rateLimit(`mcp:${principal.keyId}`, 300, 60_000)) {
    return new Response("Too many requests", { status: 429 });
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });
  const server = createMcpServer(principal);
  await server.connect(transport);
  try {
    const res = await transport.handleRequest(request, {
      authInfo: {
        token,
        clientId: principal.keyId,
        scopes: ["read"],
        extra: { userId: principal.userId, via: principal.via },
      },
    });
    return withCors(res);
  } finally {
    // Close once the response has been produced; JSON mode means the body
    // is already complete here.
    void transport.close().catch(() => {});
  }
}

/** Stateless mode has no standalone SSE stream and no sessions to delete. */
export function GET() {
  return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
}
export const DELETE = GET;
export const OPTIONS = preflight;
