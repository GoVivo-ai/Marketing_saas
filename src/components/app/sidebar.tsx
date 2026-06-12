"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Megaphone,
  Target,
  Inbox,
  Columns3,
  Sparkles,
  FileBarChart,
  Plug,
  Settings,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { VivoLogo } from "./vivo-logo";
import type { WorkspaceInfo } from "@/lib/data";

const nav = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/planner", label: "Planner", icon: Target },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/leads", label: "Leads", icon: Inbox },
  { href: "/leads/pipeline", label: "Pipeline", icon: Columns3 },
  { href: "/insights", label: "AI Insights", icon: Sparkles },
  { href: "/reports", label: "Reports", icon: FileBarChart },
];

export function AppSidebar({
  workspaces,
  activeWorkspaceId,
  role,
  canManageActive,
}: {
  workspaces: WorkspaceInfo[];
  activeWorkspaceId: string | null;
  role?: string;
  canManageActive?: boolean;
}) {
  const pathname = usePathname();

  // Connections only for those who can manage the active workspace (agency or
  // the client owner). The team link is the agency roster for agency users and
  // the client's own org for clients.
  const bottomNav = [
    ...(canManageActive
      ? [{ href: "/settings", label: "Connections", icon: Plug }]
      : []),
    {
      href: "/settings/team",
      label: role === "client" ? "Team" : "Clients & Team",
      icon: Users,
    },
    { href: "/settings/general", label: "Settings", icon: Settings },
  ];

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
      <div className="px-5 py-5">
        <VivoLogo className="h-7 w-auto" />
        <p className="mt-1.5 text-xs text-muted-foreground">MarTech Platform</p>
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
