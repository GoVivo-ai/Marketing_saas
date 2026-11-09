import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  exchangeMailCode,
  fetchMailIdentity,
  isMailProvider,
} from "@/lib/integrations/mail";
import { saveMailAccount } from "@/lib/mail-accounts";

function safeReturnPath(raw: string | undefined): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/settings/general";
}

/** Mailbox OAuth callback: validates state, exchanges code, stores tokens. */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ provider: string }> },
) {
  const returnTo = safeReturnPath(req.cookies.get("mail_oauth_return")?.value);
  const back = (mail: string) => {
    const url = new URL(returnTo, req.url);
    url.searchParams.set("mail", mail);
    const res = NextResponse.redirect(url);
    res.cookies.delete("mail_oauth_state");
    res.cookies.delete("mail_oauth_verifier");
    res.cookies.delete("mail_oauth_return");
    return res;
  };

  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(new URL("/login", req.url));

  const { provider } = await ctx.params;
  if (!isMailProvider(provider)) return back("error");

  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return back(sp.get("error") === "access_denied" ? "denied" : "error");

  const code = sp.get("code");
  const state = sp.get("state");
  const cookieState = req.cookies.get("mail_oauth_state")?.value;
  const verifier = req.cookies.get("mail_oauth_verifier")?.value;
  if (!code || !state || !verifier || state !== cookieState) return back("invalid_state");

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
  const redirectUri = `${origin}/api/mail/${provider}/callback`;

  try {
    const tokens = await exchangeMailCode({ provider, code, codeVerifier: verifier, redirectUri });
    const identity = await fetchMailIdentity(provider, tokens.accessToken);
    await saveMailAccount(session.user.id, { provider, identity, tokens });
    return back("connected");
  } catch (err) {
    console.error("[mail] connect failed", err);
    return back("error");
  }
}
