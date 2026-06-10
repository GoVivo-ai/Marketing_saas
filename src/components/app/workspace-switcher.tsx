"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, Building2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { demoWorkspaces } from "@/lib/demo-data";

/**
 * Agency users switch between client workspaces here. Client users only
 * ever see their own workspace (enforced server-side by workspace_members).
 */
export function WorkspaceSwitcher() {
  const [active, setActive] = useState(demoWorkspaces[0]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" className="w-full justify-between" />}
      >
        <span className="flex items-center gap-2 truncate">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: active.accentColor }}
          />
          <span className="truncate">{active.name}</span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="start">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Client workspaces
        </DropdownMenuLabel>
        {demoWorkspaces.map((ws) => (
          <DropdownMenuItem key={ws.id} onClick={() => setActive(ws)}>
            <span
              className="mr-2 h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: ws.accentColor }}
            />
            <span className="flex-1">{ws.name}</span>
            {ws.id === active.id && <Check className="h-4 w-4" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-muted-foreground">
          <Building2 className="mr-2 h-4 w-4" />
          Add workspace…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
