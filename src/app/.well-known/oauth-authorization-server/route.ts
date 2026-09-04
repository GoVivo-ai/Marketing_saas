import { baseUrl, oauthEndpoints, OAUTH_SCOPES, AUTH_METHODS, CORS_HEADERS, preflight } from "@/lib/oauth";

/** RFC 8414 Authorization Server Metadata. */
export function GET(request: Request) {
  const ep = oauthEndpoints(baseUrl(request));
  return Response.json(
    {
      issuer: ep.issuer,
      authorization_endpoint: ep.authorization_endpoint,
      token_endpoint: ep.token_endpoint,
      registration_endpoint: ep.registration_endpoint,
      revocation_endpoint: ep.revocation_endpoint,
      scopes_supported: OAUTH_SCOPES,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: AUTH_METHODS,
      revocation_endpoint_auth_methods_supported: AUTH_METHODS,
      service_documentation: `${ep.issuer}/settings/general`,
    },
    { headers: { ...CORS_HEADERS, "cache-control": "public, max-age=300" } },
  );
}

export const OPTIONS = preflight;
