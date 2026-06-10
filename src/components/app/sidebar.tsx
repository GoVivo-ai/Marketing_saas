"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Megaphone,
  Inbox,
  Sparkles,
  FileBarChart,
  Plug,
  Settings,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkspaceSwitcher } from "./workspace-switcher";
import type { WorkspaceInfo } from "@/lib/data";

const nav = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/leads", label: "Leads", icon: Inbox },
  { href: "/insights", label: "AI Insights", icon: Sparkles },
  { href: "/reports", label: "Reports", icon: FileBarChart },
];

const bottomNav = [
  { href: "/settings", label: "Connections", icon: Plug },
  { href: "/settings/team", label: "Clients & Team", icon: Users },
  { href: "/settings/general", label: "Settings", icon: Settings },
];

export function AppSidebar({
  workspaces,
  activeWorkspaceId,
}: {
  workspaces: WorkspaceInfo[];
  activeWorkspaceId: string | null;
}) {
  const pathname = usePathname();

  const item = (href: string, label: string, Icon: typeof LayoutDashboard) => (
    <Link
      key={href}
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        pathname === href
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r bg-card/50">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">
          V
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold">MarTech By Vivo</p>
          <p className="text-xs text-muted-foreground">Agency Platform</p>
        </div>
      </div>

      <div className="px-3 pb-2">
        <WorkspaceSwitcher workspaces={workspaces} activeId={activeWorkspaceId} />
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2">
        {nav.map((n) => item(n.href, n.label, n.icon))}
      </nav>

      <nav className="space-y-1 border-t px-3 py-3">
        {bottomNav.map((n) => item(n.href, n.label, n.icon))}
      </nav>
    </aside>
  );
}
