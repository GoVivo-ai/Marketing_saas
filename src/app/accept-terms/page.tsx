import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { VivoLogo } from "@/components/app/vivo-logo";
import {
  PLATFORM_TERMS_URL,
  PRIVACY_POLICY_URL,
  hasAcceptedPlatformTerms,
  recordPlatformTermsAcceptance,
} from "@/lib/platform-terms";

/**
 * Clickwrap for the Platform Terms (legal v1, B11). The app layout sends
 * every signed-in user here until they accept the current version; the
 * acceptance is stored with user, version, time, IP and user agent.
 */
export default async function AcceptTermsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (await hasAcceptedPlatformTerms(session.user.id)) redirect("/dashboard");

  async function accept(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user?.id) redirect("/login");
    if (formData.get("agree") !== "yes") redirect("/accept-terms");
    const h = await headers();
    const ip =
      (h.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
      h.get("x-real-ip") ||
      null;
    await recordPlatformTermsAcceptance({
      userId: s.user.id,
      email: s.user.email ?? "",
      ipAddress: ip,
      userAgent: h.get("user-agent")?.slice(0, 1000) ?? null,
    });
    redirect("/dashboard");
  }

  const link = "font-medium text-primary underline underline-offset-2";

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="dark inline-flex rounded-xl bg-sidebar p-3">
          <VivoLogo className="h-7 w-auto" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">
            Before you continue
          </h1>
          <p className="text-sm text-muted-foreground">
            To use the Vivo platform, please review and accept our Platform
            Terms of Service.
          </p>
        </div>

        <form action={accept} className="space-y-5">
          <label className="flex items-start gap-3 text-sm leading-relaxed">
            <input
              type="checkbox"
              name="agree"
              value="yes"
              required
              className="mt-1 h-4 w-4 shrink-0 accent-[#04d98b]"
            />
            <span>
              I have read and agree to the{" "}
              <a href={PLATFORM_TERMS_URL} target="_blank" rel="noopener noreferrer" className={link}>
                Platform Terms of Service
              </a>{" "}
              on behalf of myself and the organization I use Vivo for, and I
              acknowledge the{" "}
              <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer" className={link}>
                Privacy Policy
              </a>
              .
            </span>
          </label>
          <Button type="submit" className="h-11 w-full text-sm font-semibold">
            Accept and continue
          </Button>
        </form>

        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button
            type="submit"
            className="w-full text-center text-xs text-muted-foreground hover:underline"
          >
            Not now — sign out
          </button>
        </form>
      </div>
    </main>
  );
}
