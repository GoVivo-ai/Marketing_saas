"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import {
  ChevronDown,
  LayoutDashboard,
  Megaphone,
  Target,
  Inbox,
  Columns3,
  PhoneOutgoing,
  Sparkles,
  FileBarChart,
  Bus,
  Headset,
  PhoneCall,
  Plug,
  Settings,
  TerminalSquare,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SupportDialog } from "./support-dialog";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { VivoLogo } from "./vivo-logo";
import type { WorkspaceInfo } from "@/lib/data";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard };
type NavGroup = { label: string; items: NavItem[] };

// The rail is organised by module. Marketing is the campaign side, Contact is
// where leads get worked, Reports is read-only analysis, Operations is the
// dispatch team's world. Roles see whole modules, not scattered links.
const NAV_GROUPS: NavGroup[] = [
  {
    label: "Marketing",
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
      { href: "/planner", label: "Planner", icon: Target },
      { href: "/campaigns", label: "Campaigns", icon: Megaphone },
    ],
  },
  {
    label: "Contact",
    items: [
      { href: "/leads", label: "Leads", icon: Inbox },
      { href: "/leads/queue", label: "Contact Queue", icon: PhoneOutgoing },
      { href: "/leads/pipeline", label: "Pipeline", icon: Columns3 },
    ],
  },
  {
    label: "Reports",
    items: [
      { href: "/insights", label: "AI Insights", icon: Sparkles },
      { href: "/reports", label: "Funnel", icon: FileBarChart },
      { href: "/reports/agents", label: "Agent Activity", icon: Headset },
      { href: "/reports/calls", label: "Daily Calls", icon: PhoneCall },
    ],
  },
  {
    label: "Operations",
    items: [{ href: "/dispatch", label: "Dispatch", icon: Bus }],
  },
];

// The folded modules live in localStorage, exposed as a tiny external store
// so the rail renders the same on the server and on first paint (everything
// open) and then picks up the saved folds.
const COLLAPSED_KEY = "vivo.sidebar.collapsed";
const listeners = new Set<() => void>();
// In-memory copy so folding still works for the session when storage is
// blocked (private mode); it just won't survive a reload.
let memory: string | null = null;
function readCollapsed(): string {
  if (memory !== null) return memory;
  try {
    return localStorage.getItem(COLLAPSED_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}
function writeCollapsed(labels: string[]) {
  memory = JSON.stringify(labels);
  try {
    localStorage.setItem(COLLAPSED_KEY, memory);
  } catch {
    // Storage blocked; the in-memory copy carries the session.
  }
  listeners.forEach((l) => l());
}
function subscribeCollapsed(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// Agents only work their leads: the Contact module.
const AGENT_HREFS = new Set(["/leads", "/leads/queue", "/leads/pipeline"]);

// The dispatch team only works the Operations module.
const OPERATIONS_HREFS = new Set(["/dispatch"]);

export function AppSidebar({
  workspaces,
  activeWorkspaceId,
  role,
  canManageActive,
  isAgent,
}: {
  workspaces: WorkspaceInfo[];
  activeWorkspaceId: string | null;
  role?: string;
  canManageActive?: boolean;
  isAgent?: boolean;
}) {
  const pathname = usePathname();
  const active =
    workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0];
  const clientLogo = active?.logoUrl ?? null;

  const isOperations = role === "operations";
  const allowed = isOperations
    ? OPERATIONS_HREFS
    : isAgent
      ? AGENT_HREFS
      : null;
  // Filter inside each module, then drop the modules that end up empty so a
  // role never sees a heading with nothing under it.
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: allowed ? g.items.filter((n) => allowed.has(n.href)) : g.items,
  })).filter((g) => g.items.length > 0);

  // Which modules the user has folded. Persisted per browser so the rail
  // opens the way they left it; the module holding the current page is
  // always open so the active link is never hidden behind a fold.
  const collapsed = useSyncExternalStore(
    subscribeCollapsed,
    readCollapsed,
    () => "[]",
  );
  const folded = new Set(JSON.parse(collapsed) as string[]);
  const toggle = (label: string) => {
    if (folded.has(label)) folded.delete(label);
    else folded.add(label);
    writeCollapsed([...folded]);
  };

  // Connections only for those who can manage the active workspace (agency or
  // the client's supervisors/admins). The team link is the agency roster for
  // agency users and the client's own org for clients; agents don't get it —
  // they keep Settings for their own account (password, dialer).
  const bottomNav = [
    ...(canManageActive && !isOperations
      ? [{ href: "/settings", label: "Connections", icon: Plug }]
      : []),
    ...(isAgent || isOperations
      ? []
      : [
          {
            href: "/settings/team",
            label: role === "client" ? "Team" : "Clients & Team",
            icon: Users,
          },
        ]),
    { href: "/settings/general", label: "Settings", icon: Settings },
    // Developers get their own dashboard: maintenance mode + system status.
    ...(role === "developer"
      ? [{ href: "/dev", label: "Developer", icon: TerminalSquare }]
      : []),
  ];

  // Support = open a ticket with the Vivo Assistant (Slack follow-up). Agency
  // users file from here; clients keep their own channels.
  const showSupport =
    role === "agency_admin" || role === "agency_member" || role === "developer";

  const item = (href: string, label: string, Icon: typeof LayoutDashboard) => (
    <Link
      key={href}
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        // Exact match only: /reports/agents must not light "Funnel" too.
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
    // The `dark` class scopes the navy brand look to the rail: the sidebar
    // keeps the VIVO identity while the content canvas stays light gray.
    <aside className="dark flex h-screen w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="px-5 py-5">
        <div className="flex items-center gap-3">
          <VivoLogo className="h-7 w-auto shrink-0" />
          {clientLogo && (
            <>
              {/* Divider between the Vivo logo and the active client's logo. */}
              <span className="h-9 w-px shrink-0 bg-border" />
              {/* Forced white so any brand logo reads cleanly on the dark rail. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={clientLogo}
                alt={active?.name ?? "Client logo"}
                className="h-10 w-auto max-w-[140px] shrink-0 object-contain"
                style={{ filter: "brightness(0) invert(1)" }}
              />
            </>
          )}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">MarTech Platform</p>
      </div>

      <div className="px-3 pb-2">
        <WorkspaceSwitcher workspaces={workspaces} activeId={activeWorkspaceId} />
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-2">
        {groups.map((g) => {
          const holdsCurrent = g.items.some((n) => n.href === pathname);
          const open = holdsCurrent || !folded.has(g.label);
          return (
            <div key={g.label} className="space-y-1">
              {/* A heading only earns its place when there is more than one
                module to tell apart. */}
              {groups.length > 1 && (
                <button
                  type="button"
                  onClick={() => toggle(g.label)}
                  aria-expanded={open}
                  className="flex w-full items-center justify-between rounded-md px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 transition-colors hover:text-foreground"
                >
                  {g.label}
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 transition-transform",
                      !open && "-rotate-90",
                    )}
                  />
                </button>
              )}
              {open && g.items.map((n) => item(n.href, n.label, n.icon))}
            </div>
          );
        })}
      </nav>

      <nav className="space-y-1 border-t px-3 py-3">
        {showSupport && <SupportDialog />}
        {bottomNav.map((n) => item(n.href, n.label, n.icon))}
      </nav>
    </aside>
  );
}
