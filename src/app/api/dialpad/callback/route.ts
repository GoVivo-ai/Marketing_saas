import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { exchangeCode, fetchMe, toExpiresInSec } from "@/lib/integrations/dialpad";
import { setDialpadTokens } from "@/lib/settings";

/** Dialpad OAuth callback: validates state, exchanges code, stores tokens. */
export async function GET(req: NextRequest) {
  const back = (dp: string) =>
    NextResponse.redirect(new URL(`/settings/general?dp=${dp}`, req.url));

  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(new URL("/login", req.url));

  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return back("error");

  const code = sp.get("code");
  const state = sp.get("state");
  const cookieState = req.cookies.get("dp_oauth_state")?.value;
  const verifier = req.cookies.get("dp_oauth_verifier")?.value;
  if (!code || !state || !verifier || state !== cookieState) {
    return back("invalid_state");
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
  const redirectUri = `${origin}/api/dialpad/callback`;

  try {
    const tokens = await exchangeCode({ code, codeVerifier: verifier, redirectUri });

    // Identify the user — required so calls/SMS can be placed on their behalf.
    const me = await fetchMe(tokens.access_token);

    await setDialpadTokens(session.user.id, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresInSec: toExpiresInSec(tokens.expires_in),
      fromNumber: me.phoneNumber,
      dialpadUserId: me.dialpadUserId,
    });

    const res = back("connected");
    res.cookies.delete("dp_oauth_state");
    res.cookies.delete("dp_oauth_verifier");
    return res;
  } catch {
    return back("error");
  }
}
