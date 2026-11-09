import { NextRequest, NextResponse } from "next/server";
import { generateState, outlookAdminConsentUrl } from "@/lib/integrations/mail";

/**
 * Link to hand a client's Microsoft 365 administrator when their users hit
 * "Need admin approval" connecting Outlook. Public on purpose: the admin has
 * no account here. It only forwards to Microsoft; the decision happens there
 * and comes back to /api/mail/outlook/callback with admin_consent=True.
 */
export async function GET(req: NextRequest) {
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
  const url = outlookAdminConsentUrl(`${origin}/api/mail/outlook/callback`, generateState());
  if (!url) return NextResponse.json({ error: "Outlook isn't configured" }, { status: 503 });
  return NextResponse.redirect(url);
}
