import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAgentOnly } from "@/lib/permissions";
import {
  buildAuthorizeUrl,
  generatePkce,
  generateState,
  isDialpadConfigured,
} from "@/lib/integrations/dialpad";

/** Starts the Dialpad OAuth flow: sets PKCE + state cookies, redirects. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL("/login", req.url));
  // Agents can't manage telephony tokens.
  if (await isAgentOnly())
    return NextResponse.redirect(new URL("/settings/general", req.url));
  if (!isDialpadConfigured()) {
    return NextResponse.redirect(
      new URL("/settings/general?dp=not_configured", req.url),
    );
  }

  const { verifier, challenge } = generatePkce();
  const state = generateState();
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
  const redirectUri = `${origin}/api/dialpad/callback`;

  const res = NextResponse.redirect(
    buildAuthorizeUrl({ state, codeChallenge: challenge, redirectUri }),
  );
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
  };
  res.cookies.set("dp_oauth_state", state, cookieOpts);
  res.cookies.set("dp_oauth_verifier", verifier, cookieOpts);
  return res;
}
