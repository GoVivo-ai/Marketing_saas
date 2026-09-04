import { redirect } from "next/navigation";
import { ShieldCheck, Eye, Ban } from "lucide-react";
import { auth } from "@/lib/auth";
import { isDemoEmail } from "@/lib/demo";
import { issueCode, validateAuthorizeRequest, OAuthError } from "@/lib/oauth";
import { VivoLogo } from "@/components/app/vivo-logo";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

const READ_ONLY_ITEMS = [
  "Campaign performance and KPIs",
  "Leads, pipeline stages and lead history",
  "Funnel, agent activity and sync reports",
];

/**
 * OAuth consent screen. The user must already be signed in (we bounce
 * through /login?next= otherwise); approving mints a one-shot code that the
 * client trades for a read-only token at /api/oauth/token.
 */
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") q.set(k, v);
  }
  const qs = q.toString();

  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${qs}`)}`);
  }
  const email = session.user.email ?? "";

  let params: Awaited<ReturnType<typeof validateAuthorizeRequest>>;
  try {
    params = await validateAuthorizeRequest(q);
  } catch (e) {
    const err = e instanceof OAuthError ? e : new OAuthError("server_error", "Unexpected error.");
    // Only bounce back to the client when we trust its redirect_uri.
    const redirectUri = q.get("redirect_uri");
    if (err.code !== "invalid_client" && err.code !== "invalid_request" && redirectUri) {
      redirect(errorRedirect(redirectUri, err.code, err.message, q.get("state")));
    }
    return (
      <Shell>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Ban className="h-4 w-4 text-destructive" />
            Can&apos;t authorize this app
          </CardTitle>
          <CardDescription>{err.message}</CardDescription>
        </CardHeader>
      </Shell>
    );
  }

  async function approve() {
    "use server";
    const s = await auth();
    const uid = s?.user?.id;
    if (!uid || isDemoEmail(s?.user?.email)) redirect("/login");
    // Re-validate from the original query so nothing can be tampered
    // with between render and submit.
    const p = await validateAuthorizeRequest(new URLSearchParams(qs));
    const code = await issueCode(uid, p);
    const u = new URL(p.redirectUri);
    u.searchParams.set("code", code);
    if (p.state) u.searchParams.set("state", p.state);
    redirect(u.toString());
  }

  async function deny() {
    "use server";
    const p = await validateAuthorizeRequest(new URLSearchParams(qs));
    redirect(errorRedirect(p.redirectUri, "access_denied", "The user denied the request.", p.state));
  }

  if (isDemoEmail(email)) {
    return (
      <Shell>
        <CardHeader>
          <CardTitle className="text-base">Not available in demo mode</CardTitle>
          <CardDescription>
            The demo account can&apos;t connect external tools. Book a call with
            Vivo to see it live.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <form action={deny}>
            <Button type="submit" variant="outline">
              Back to {params.clientName}
            </Button>
          </form>
        </CardFooter>
      </Shell>
    );
  }

  return (
    <Shell>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShieldCheck className="h-5 w-5 text-primary" />
          Allow {params.clientName} to read your Vivo data?
        </CardTitle>
        <CardDescription>
          Signed in as <span className="font-medium text-foreground">{email}</span>.
          The app will see exactly what you can see in the platform, and nothing more.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Eye className="h-4 w-4 text-muted-foreground" />
          Read-only access to
        </p>
        <ul className="list-disc space-y-1 pl-6 text-sm text-muted-foreground">
          {READ_ONLY_ITEMS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          It cannot create, change or delete anything. You can disconnect it at
          any time from Settings → API access.
        </p>
      </CardContent>
      <CardFooter className="flex justify-end gap-2">
        <form action={deny}>
          <Button type="submit" variant="outline">
            Deny
          </Button>
        </form>
        <form action={approve}>
          <Button type="submit">Allow access</Button>
        </form>
      </CardFooter>
    </Shell>
  );
}

function errorRedirect(redirectUri: string, code: string, description: string, state: string | null) {
  const u = new URL(redirectUri);
  u.searchParams.set("error", code);
  u.searchParams.set("error_description", description);
  if (state) u.searchParams.set("state", state);
  return u.toString();
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-6">
      <div className="dark rounded-xl bg-sidebar px-4 py-3">
        <VivoLogo />
      </div>
      <Card className="w-full max-w-md">{children}</Card>
    </main>
  );
}
