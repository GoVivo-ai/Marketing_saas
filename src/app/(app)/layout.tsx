import { redirect } from "next/navigation";
import { Wrench, LogOut, Sparkles } from "lucide-react";
import { isDemoEmail } from "@/lib/demo";
import { auth, signOut } from "@/lib/auth";
import { getWorkspaceContext } from "@/lib/data";
import { getMaintenance } from "@/lib/settings";
import { canManageWorkspace, isWorkspaceAgent } from "@/lib/permissions";
import { VivoLogo } from "@/components/app/vivo-logo";
import { LocalDateTime } from "@/components/app/local-datetime";
import { AppSidebar } from "@/components/app/sidebar";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Toaster } from "@/components/ui/sonner";
import { RingCentralDialer } from "@/components/app/ringcentral-dialer";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as { role?: string }).role;

  // Maintenance mode (flipped from /dev, or a scheduled window): non-developers
  // get a maintenance screen instead of the app; developers keep working with
  // a banner. `active` covers both the manual switch and the window.
  const maintenance = await getMaintenance();
  if (maintenance.active && role !== "developer") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="dark rounded-xl bg-sidebar p-4">
          <VivoLogo className="h-8 w-auto" />
        </div>
        <div className="flex items-center gap-2 text-lg font-semibold">
          <Wrench className="h-5 w-5 text-amber-500" />
          Under maintenance
        </div>
        <p className="max-w-md text-sm text-muted-foreground">
          {maintenance.message ??
            "We're doing scheduled maintenance and will be back shortly. Your data is safe."}
        </p>
        {/* A window gives users a concrete comeback time. */}
        {!maintenance.enabled && maintenance.scheduledEnd && (
          <p className="text-sm text-muted-foreground">
            Estimated to be back by{" "}
            <span className="font-medium text-foreground">
              <LocalDateTime iso={maintenance.scheduledEnd} />
            </span>
            .
          </p>
        )}
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <Button variant="outline" size="sm" type="submit">
            <LogOut className="mr-1.5 h-3.5 w-3.5" />
            Sign out
          </Button>
        </form>
      </div>
    );
  }

  const { workspaces, active } = await getWorkspaceContext();
  const [canManageActive, isAgent] = active
    ? await Promise.all([canManageWorkspace(active.id), isWorkspaceAgent(active.id)])
    : [false, false];

  const initials = (session.user.name ?? "U")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar
        workspaces={workspaces}
        activeWorkspaceId={active?.id ?? null}
        role={role}
        canManageActive={canManageActive}
        isAgent={isAgent}
      />
      {/* min-w-0 lets this flex item shrink to the viewport, so wide content
          (e.g. a pipeline with many stages) scrolls inside instead of
          stretching the page. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {isDemoEmail(session.user.email) && (
          <div className="flex shrink-0 items-center gap-2 border-b border-violet-500/40 bg-violet-500/10 px-6 py-2 text-sm text-violet-600 dark:text-violet-400">
            <Sparkles className="h-4 w-4 shrink-0" />
            <span>
              Demo mode — you&apos;re exploring sample data. Feel free to move
              leads around; settings and messaging are disabled and everything
              resets periodically.
            </span>
          </div>
        )}
        {maintenance.active && (
          <div className="flex shrink-0 items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-6 py-2 text-sm text-amber-600 dark:text-amber-400">
            <Wrench className="h-4 w-4 shrink-0" />
            <span>
              Maintenance mode is ON
              {!maintenance.enabled && maintenance.scheduledEnd && (
                <>
                  {" "}
                  (scheduled window, ends{" "}
                  <LocalDateTime iso={maintenance.scheduledEnd} />)
                </>
              )}{" "}
              — everyone except developers sees the maintenance screen. Manage
              it from the Developer dashboard.
            </span>
          </div>
        )}
        {/* Advance notice for everyone before a scheduled window starts;
            developers additionally get the pointer to manage it. */}
        {!maintenance.active && maintenance.upcoming && maintenance.scheduledStart && (
          <div className="flex shrink-0 items-center gap-2 border-b border-sky-500/40 bg-sky-500/10 px-6 py-2 text-sm text-sky-600 dark:text-sky-400">
            <Wrench className="h-4 w-4 shrink-0" />
            <span>
              Scheduled maintenance:{" "}
              <LocalDateTime iso={maintenance.scheduledStart} />
              {maintenance.scheduledEnd && (
                <>
                  {" "}
                  → <LocalDateTime iso={maintenance.scheduledEnd} />
                </>
              )}
              . The platform will be unavailable during this window.
              {role === "developer" &&
                " Cancel or adjust it from the Developer dashboard."}
            </span>
          </div>
        )}
        <header className="flex h-14 shrink-0 items-center justify-end gap-3 border-b px-6">
          <ThemeToggle />
          <div className="text-right leading-tight">
            <p className="text-sm font-medium">{session.user.name}</p>
            <p className="text-xs text-muted-foreground">{session.user.email}</p>
          </div>
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <Button variant="ghost" size="icon" type="submit" title="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </form>
        </header>
        {/* Key by workspace so switching clients remounts the page — client
            components don't keep the previous client's data in local state. */}
        <main key={active?.id ?? "none"} className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
      <Toaster />
      <RingCentralDialer workspaceId={active?.id ?? "none"} />
    </div>
  );
}
