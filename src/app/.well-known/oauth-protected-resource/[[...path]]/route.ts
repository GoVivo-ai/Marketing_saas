import { baseUrl, oauthEndpoints, OAUTH_SCOPES, CORS_HEADERS, preflight } from "@/lib/oauth";

/**
 * RFC 9728 Protected Resource Metadata. MCP clients read this after a 401 to
 * learn which authorization server protects /api/mcp. Served at both the
 * root and the path-specific location (/api/mcp) since clients try either.
 */
export function GET(request: Request) {
  const ep = oauthEndpoints(baseUrl(request));
  return Response.json(
    {
      resource: ep.resource,
      authorization_servers: [ep.issuer],
      scopes_supported: OAUTH_SCOPES,
      bearer_methods_supported: ["header"],
      resource_name: "Vivo Marketing MCP",
    },
    { headers: { ...CORS_HEADERS, "cache-control": "public, max-age=300" } },
  );
}

export const OPTIONS = preflight;
