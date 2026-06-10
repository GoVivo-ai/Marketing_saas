"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { format, parseISO } from "date-fns";
import { Calendar as CalendarIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar, type DayRange } from "@/components/ui/calendar";

export interface PresetOption {
  value: string;
  label: string;
}

/**
 * Date-range control: quick presets plus a calendar for an exact custom
 * window. Writes the selection to the URL (`?range=` or `?from=&to=`) so the
 * server component re-fetches. The current label is rendered by the server.
 */
export function DateRangePicker({
  presets,
  defaultValue,
  label,
}: {
  presets: PresetOption[];
  defaultValue: string;
  label: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const activePreset =
    searchParams.get("range") ?? (fromParam ? "custom" : defaultValue);

  const [draft, setDraft] = useState<DayRange>({
    from: fromParam ? parseISO(fromParam) : undefined,
    to: toParam ? parseISO(toParam) : undefined,
  });

  const navigate = (params: URLSearchParams) => {
    const query = params.toString();
    setOpen(false);
    startTransition(() => {
      router.push(query ? `${pathname}?${query}` : pathname);
    });
  };

  const applyPreset = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("from");
    params.delete("to");
    params.delete("page"); // a new range starts at page 1
    if (value === defaultValue) params.delete("range");
    else params.set("range", value);
    navigate(params);
  };

  const applyCustom = () => {
    if (!draft.from || !draft.to) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("range");
    params.delete("page"); // a new range starts at page 1
    params.set("from", format(draft.from, "yyyy-MM-dd"));
    params.set("to", format(draft.to, "yyyy-MM-dd"));
    navigate(params);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="outline" size="sm" className="gap-1.5" />}
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <CalendarIcon className="h-3.5 w-3.5" />
        )}
        {label}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[300px]">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <Button
                key={p.value}
                variant={activePreset === p.value ? "default" : "outline"}
                size="sm"
                onClick={() => applyPreset(p.value)}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="border-t pt-3">
            <Calendar value={draft} onChange={setDraft} />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {draft.from && draft.to
                  ? `${format(draft.from, "MMM d")} – ${format(draft.to, "MMM d, yyyy")}`
                  : draft.from
                    ? `${format(draft.from, "MMM d")} – …`
                    : "Pick start & end"}
              </span>
              <Button
                size="sm"
                disabled={!draft.from || !draft.to}
                onClick={applyCustom}
              >
                Apply
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
