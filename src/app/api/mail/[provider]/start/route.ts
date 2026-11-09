import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  buildMailAuthorizeUrl,
  generatePkce,
  generateState,
  isMailProvider,
  isMailProviderConfigured,
} from "@/lib/integrations/mail";

/** Only same-site paths; anything else goes back to Settings. */
function safeReturnPath(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/settings/general";
}

/**
 * Starts the mailbox OAuth flow for Gmail or Outlook. Any signed-in user,
 * agents included — the mailbox is personal and it's what lets them email
 * leads from the queue. `?return=` brings them back to where they clicked.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ provider: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL("/login", req.url));

  const { provider } = await ctx.params;
  const returnTo = safeReturnPath(req.nextUrl.searchParams.get("return"));
  const back = (mail: string) => {
    const url = new URL(returnTo, req.url);
    url.searchParams.set("mail", mail);
    return NextResponse.redirect(url);
  };
  if (!isMailProvider(provider)) return back("error");
  if (!isMailProviderConfigured(provider)) return back("not_configured");

  const { verifier, challenge } = generatePkce();
  const state = generateState();
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
  const redirectUri = `${origin}/api/mail/${provider}/callback`;

  const res = NextResponse.redirect(
    buildMailAuthorizeUrl({ provider, state, codeChallenge: challenge, redirectUri }),
  );
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
  };
  res.cookies.set("mail_oauth_state", state, cookieOpts);
  res.cookies.set("mail_oauth_verifier", verifier, cookieOpts);
  res.cookies.set("mail_oauth_return", returnTo, cookieOpts);
  return res;
}
