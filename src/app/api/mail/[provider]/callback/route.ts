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

  const sp = req.nextUrl.searchParams;

  // Entra admin consent comes back here too (admin_consent=True&tenant=…).
  // The admin is usually the client's IT person, with no account on the
  // platform, so answer with a plain page instead of bouncing them to login.
  if (sp.has("admin_consent")) {
    const granted = sp.get("admin_consent") === "True" && !sp.get("error");
    return new NextResponse(adminConsentPage(granted, sp.get("error_description")), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(new URL("/login", req.url));

  const { provider } = await ctx.params;
  if (!isMailProvider(provider)) return back("error");

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

function adminConsentPage(granted: boolean, detail: string | null): string {
  const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const title = granted ? "Permission granted" : "Permission not granted";
  const body = granted
    ? "Martech By Vivo can now send email on behalf of the people in your organization who connect their Outlook. You can close this window — your team can connect Outlook from the platform right away."
    : `The permission was not granted.${detail ? ` Microsoft said: ${esc(detail)}` : ""} You can close this window and try again from the link you were given.`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · Martech By Vivo</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f4f4f4;color:#1f2937}main{max-width:28rem;background:#fff;border-radius:16px;padding:2rem;box-shadow:0 10px 30px rgba(0,0,0,.08)}h1{font-size:1.25rem;margin:0 0 .5rem;color:${granted ? "#047a52" : "#b3261e"}}p{line-height:1.5;margin:0}</style></head>
<body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
}
