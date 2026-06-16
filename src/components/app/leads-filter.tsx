"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronsUpDown, Layers, Loader2, MapPin } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export interface FilterOption {
  value: string;
  label: string;
  /** Optional dot color (used by the stage filter). */
  color?: string | null;
}

/**
 * Icons are resolved by key inside this client component — a Lucide component
 * can't be passed as a prop from a Server Component (functions aren't
 * serializable across the boundary).
 */
const ICONS = { stage: Layers, city: MapPin } as const;
export type FilterIcon = keyof typeof ICONS;

/**
 * Generic single-select leads filter driven by a URL search param. Used for the
 * stage ("Not Interested" / "Not Qualified" segmented views) and city/area
 * slices that replace the spreadsheet's separate tabs.
 */
export function LeadsFilter({
  param,
  icon,
  allLabel,
  options,
  activeValue,
}: {
  param: string;
  icon: FilterIcon;
  allLabel: string;
  options: FilterOption[];
  activeValue: string | null;
}) {
  const Icon = ICONS[icon];
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const active = options.find((o) => o.value === activeValue);

  const select = (value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page"); // a new filter starts at page 1
    if (value) params.set(param, value);
    else params.delete(param);
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
          <Icon className="h-3.5 w-3.5" />
        )}
        <span className="truncate">{active ? active.label : allLabel}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[340px] w-64 overflow-auto">
        <DropdownMenuItem onClick={() => select(null)}>
          <span className="flex-1">{allLabel}</span>
          {!activeValue && <Check className="h-4 w-4" />}
        </DropdownMenuItem>
        {options.map((o) => (
          <DropdownMenuItem key={o.value} onClick={() => select(o.value)}>
            {o.color && (
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: o.color }}
              />
            )}
            <span className="flex-1 truncate">{o.label}</span>
            {activeValue === o.value && (
              <Check className="ml-2 h-4 w-4 shrink-0" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
