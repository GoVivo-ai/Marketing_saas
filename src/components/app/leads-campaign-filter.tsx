"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronsUpDown, Loader2, Megaphone } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

/** Filters the leads list by campaign via the `?campaign=` URL param. */
export function LeadsCampaignFilter({
  campaigns,
  activeId,
}: {
  campaigns: { id: string; name: string }[];
  activeId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const active = campaigns.find((c) => c.id === activeId);

  const select = (id: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page"); // a new filter starts at page 1
    if (id) params.set("campaign", id);
    else params.delete("campaign");
    const query = params.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" className="max-w-[240px] gap-1.5" />}
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Megaphone className="h-3.5 w-3.5" />
        )}
        <span className="truncate">{active ? active.name : "All campaigns"}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[340px] w-64 overflow-auto">
        <DropdownMenuItem onClick={() => select(null)}>
          <span className="flex-1">All campaigns</span>
          {!activeId && <Check className="h-4 w-4" />}
        </DropdownMenuItem>
        {campaigns.map((c) => (
          <DropdownMenuItem key={c.id} onClick={() => select(c.id)}>
            <span className="flex-1 truncate">{c.name}</span>
            {activeId === c.id && <Check className="ml-2 h-4 w-4 shrink-0" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
