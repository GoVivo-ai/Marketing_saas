import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  buildAuthorizeUrl,
  generatePkce,
  generateState,
  isRingCentralConfigured,
} from "@/lib/integrations/ringcentral";

/** Starts the RingCentral OAuth flow: sets PKCE + state cookies, redirects. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL("/login", req.url));
  if (!(await isRingCentralConfigured())) {
    return NextResponse.redirect(
      new URL("/settings/general?rc=not_configured", req.url),
    );
  }

  const { verifier, challenge } = generatePkce();
  const state = generateState();
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
  const redirectUri = `${origin}/api/ringcentral/callback`;

  const res = NextResponse.redirect(
    await buildAuthorizeUrl({ state, codeChallenge: challenge, redirectUri }),
  );
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
  };
  res.cookies.set("rc_oauth_state", state, cookieOpts);
  res.cookies.set("rc_oauth_verifier", verifier, cookieOpts);
  return res;
}
