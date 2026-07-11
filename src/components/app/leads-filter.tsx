"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Check,
  ChevronsUpDown,
  Crosshair,
  Layers,
  Loader2,
  MapPin,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MultiFilter, type MultiFilterIcon } from "@/components/app/multi-filter";

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
const ICONS = { stage: Layers, city: MapPin, adset: Crosshair } as const;
export type FilterIcon = keyof typeof ICONS;

/**
 * Multi-select leads filter driven by a URL search param (comma-separated
 * values; absent = all). Same checkbox dropdown as the in-memory MultiFilter,
 * but routed so Server Components can filter on it.
 */
export function LeadsMultiFilter({
  param,
  icon,
  title,
  allLabel,
  options,
  activeValues,
}: {
  param: string;
  icon: MultiFilterIcon;
  title: string;
  allLabel: string;
  options: FilterOption[];
  activeValues: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const onChange = (values: string[]) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page"); // a new filter starts at page 1
    if (values.length) params.set(param, values.join(","));
    else params.delete(param);
    const query = params.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
  };

  return (
    <MultiFilter
      title={title}
      icon={icon}
      allLabel={allLabel}
      options={options}
      selected={activeValues}
      onChange={onChange}
      pending={pending}
    />
  );
}

/**
 * Generic single-select leads filter driven by a URL search param. Used for the
 * stage ("Not Interested" / "Not Qualified" segmented views) and city/area
 * slices that replace the spreadsheet's separate tabs.
 */
export function LeadsFilter({
  param,
  icon,
  title,
  allLabel,
  options,
  activeValue,
}: {
  param: string;
  icon: FilterIcon;
  /** Small muted name shown before the control, so users know what it filters. */
  title?: string;
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

  const dropdown = (
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

  if (!title) return dropdown;
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{title}</span>
      {dropdown}
    </label>
  );
}
