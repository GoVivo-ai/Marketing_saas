"use client";

import {
  ChevronsUpDown,
  Crosshair,
  Headset,
  Layers,
  Loader2,
  Map,
  MapPin,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

/** Icons resolved by key — components can't cross the RSC boundary as props. */
const ICONS = { stage: Layers, city: MapPin, adset: Crosshair, state: Map, agent: Headset } as const;
export type MultiFilterIcon = keyof typeof ICONS;

/**
 * Generic multi-select filter: a checkbox dropdown that stays open while
 * toggling, with a small muted title so users know what the control filters.
 * Empty selection = no filter ("all").
 */
export function MultiFilter({
  title,
  icon,
  allLabel,
  options,
  selected,
  onChange,
  pending = false,
}: {
  title: string;
  icon: MultiFilterIcon;
  allLabel: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
  pending?: boolean;
}) {
  const Icon = ICONS[icon];
  const toggle = (value: string, checked: boolean) =>
    onChange(
      checked ? [...selected, value] : selected.filter((v) => v !== value),
    );

  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? options.find((o) => o.value === selected[0])?.label ?? selected[0]
        : `${selected.length} selected`;

  return (
    <label className="flex items-center gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{title}</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm" className="max-w-[240px] gap-1.5" />
          }
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Icon className="h-3.5 w-3.5" />
          )}
          <span className="truncate">{summary}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[340px] w-64 overflow-auto">
          {/* Select all ticks every option so single ones can be unticked;
              Clear goes back to the implicit "all" (no filter). */}
          <DropdownMenuItem
            closeOnClick={false}
            onClick={() => onChange(options.map((o) => o.value))}
          >
            <span className="flex-1">Select all ({options.length})</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onChange([])}>
            <span className="flex-1">{allLabel} (clear)</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {options.map((o) => (
            <DropdownMenuCheckboxItem
              key={o.value}
              checked={selected.includes(o.value)}
              onCheckedChange={(checked) => toggle(o.value, checked)}
              closeOnClick={false}
            >
              <span className="flex-1 truncate">{o.label}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </label>
  );
}
