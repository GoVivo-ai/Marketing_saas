"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { WorkspaceInfo } from "@/lib/data";

/**
 * Agency users switch between client workspaces here. Client users only
 * see their own workspace(s) — the list is filtered server-side.
 */
export function WorkspaceSwitcher({
  workspaces,
  activeId,
}: {
  workspaces: WorkspaceInfo[];
  activeId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];

  if (!active) return null;

  // Plain client-side cookie: switching workspaces never depends on a
  // server action, so it keeps working across deployments (no skew errors).
  const select = (slug: string) => {
    document.cookie = `ws=${slug}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" className="w-full justify-between" />}
      >
        <span className="flex items-center gap-2 truncate">
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: active.accentColor ?? "#04d98b" }}
            />
          )}
          <span className="truncate">{active.name}</span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Client workspaces
          </DropdownMenuLabel>
          {workspaces.map((ws) => (
            <DropdownMenuItem key={ws.id} onClick={() => select(ws.slug)}>
              <span
                className="mr-2 h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: ws.accentColor ?? "#04d98b" }}
              />
              <span className="flex-1">
                {ws.name}
                {!ws.connected && (
                  <span className="block text-xs text-muted-foreground">
                    Not connected
                  </span>
                )}
              </span>
              {ws.id === active.id && <Check className="h-4 w-4" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
