import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { Mail, Lock, Sparkles, BarChart3, Users } from "lucide-react";
import { auth, signIn } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VivoLogo } from "@/components/app/vivo-logo";

const highlights = [
  { icon: BarChart3, text: "Unified campaign performance" },
  { icon: Sparkles, text: "AI-powered insights & lead scoring" },
  { icon: Users, text: "Multi-client for your agency" },
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; email?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/dashboard");
  const { error, email: prevEmail } = await searchParams;

  async function login(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "");
    try {
      await signIn("credentials", {
        email,
        password: formData.get("password"),
        redirectTo: "/dashboard",
      });
    } catch (err) {
      // Keep the typed email so a wrong password doesn't clear the form.
      if (err instanceof AuthError)
        redirect(`/login?error=1&email=${encodeURIComponent(email)}`);
      throw err;
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* ---------- Brand showcase panel ---------- */}
      <section className="relative hidden overflow-hidden bg-[#011640] p-12 lg:flex lg:flex-col lg:justify-between">
        {/* animated gradient glows */}
        <div
          aria-hidden
          className="vivo-float pointer-events-none absolute -top-32 -left-24 h-96 w-96 rounded-full bg-[#04d98b]/30 blur-3xl"
        />
        <div
          aria-hidden
          className="vivo-float-slow pointer-events-none absolute -right-24 bottom-0 h-[30rem] w-[30rem] rounded-full bg-[#f2e205]/12 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/3 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-[#026a60]/40 blur-3xl"
        />
        {/* subtle grid texture */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:48px_48px]"
        />

        <div className="relative z-10">
          <VivoLogo className="h-11 w-auto" />
        </div>

        <div className="relative z-10 space-y-7">
          <div className="bg-vivo-gradient h-1.5 w-28 rounded-full" />
          <h1 className="max-w-md text-4xl leading-tight font-extrabold tracking-tight text-white">
            Marketing intelligence,{" "}
            <span className="text-vivo-gradient">all in one place</span>.
          </h1>
          <p className="max-w-sm text-base text-white/65">
            Ad performance, AI insights and lead management — unified for
            every client you serve.
          </p>
          <ul className="space-y-4 pt-2">
            {highlights.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-white/85">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15 backdrop-blur-sm">
                  <Icon className="h-4 w-4 text-[#04d98b]" />
                </span>
                <span className="text-sm font-medium">{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 text-xs text-white/40">
          © 2026 VIVO · by GoVivo.ai
        </p>
      </section>

      {/* ---------- Sign-in panel ---------- */}
      <section className="relative flex items-center justify-center bg-background p-6 sm:p-10">
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 right-0 hidden h-80 w-80 rounded-full bg-[#04d98b]/10 blur-3xl lg:block"
        />
        <div className="relative z-10 w-full max-w-sm space-y-8">
          {/* mobile logo */}
          <div className="flex flex-col items-center gap-2 lg:hidden">
            <VivoLogo className="h-10 w-auto" />
            <div className="bg-vivo-gradient h-1 w-20 rounded-full" />
          </div>

          <div className="space-y-1.5">
            <h2 className="text-2xl font-bold tracking-tight">
              Welcome back
            </h2>
            <p className="text-sm text-muted-foreground">
              Sign in to your marketing workspace
            </p>
          </div>

          <form action={login} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="you@govivo.ai"
                  autoComplete="email"
                  defaultValue={prevEmail ?? ""}
                  required
                  className="h-11 pl-10"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="h-11 pl-10"
                />
              </div>
            </div>
            {error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Invalid email or password. Please try again.
              </p>
            )}
            <Button
              type="submit"
              className="h-11 w-full text-sm font-semibold shadow-lg shadow-[#04d98b]/20"
            >
              Sign in
            </Button>
          </form>

          <p className="text-center text-xs text-muted-foreground">
            Having trouble signing in? Contact your administrator.
          </p>
        </div>
      </section>
    </main>
  );
}
