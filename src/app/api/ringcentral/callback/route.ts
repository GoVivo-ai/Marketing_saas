import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { exchangeCode, fetchPrimaryNumber } from "@/lib/integrations/ringcentral";
import { setRingCentralTokens } from "@/lib/settings";

/** RingCentral OAuth callback: validates state, exchanges code, stores tokens. */
export async function GET(req: NextRequest) {
  const back = (rc: string) =>
    NextResponse.redirect(new URL(`/settings/general?rc=${rc}`, req.url));

  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(new URL("/login", req.url));

  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return back("error");

  const code = sp.get("code");
  const state = sp.get("state");
  const cookieState = req.cookies.get("rc_oauth_state")?.value;
  const verifier = req.cookies.get("rc_oauth_verifier")?.value;
  if (!code || !state || !verifier || state !== cookieState) {
    return back("invalid_state");
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
  const redirectUri = `${origin}/api/ringcentral/callback`;

  try {
    const tokens = await exchangeCode({ code, codeVerifier: verifier, redirectUri });

    let fromNumber: string | null = null;
    let smsCapable = false;
    try {
      const num = await fetchPrimaryNumber(tokens.access_token);
      fromNumber = num?.phoneNumber ?? null;
      smsCapable = num?.smsCapable ?? false;
    } catch {
      // Number lookup is best-effort; the connection still succeeds.
    }

    await setRingCentralTokens(session.user.id, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresInSec: tokens.expires_in,
      refreshExpiresInSec: tokens.refresh_token_expires_in,
      fromNumber,
      ownerId: tokens.owner_id ?? null,
    });

    const res = back(smsCapable ? "connected" : "connected_no_sms");
    res.cookies.delete("rc_oauth_state");
    res.cookies.delete("rc_oauth_verifier");
    return res;
  } catch {
    return back("error");
  }
}
