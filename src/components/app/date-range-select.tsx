"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface RangeOption {
  value: string;
  label: string;
}

/**
 * URL-driven date-range filter. Writes the chosen range to a search param
 * (default `range`) so the server component can re-fetch for that window.
 * Keeps any other existing params intact.
 */
export function DateRangeSelect({
  options,
  defaultValue,
  paramKey = "range",
}: {
  options: RangeOption[];
  defaultValue: string;
  paramKey?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const current = searchParams.get(paramKey) ?? defaultValue;

  const onChange = (value: string | null) => {
    if (value == null) return;
    const params = new URLSearchParams(searchParams.toString());
    if (value === defaultValue) {
      params.delete(paramKey);
    } else {
      params.set(paramKey, value);
    }
    const query = params.toString();
    startTransition(() => {
      router.push(query ? `${pathname}?${query}` : pathname);
    });
  };

  return (
    <Select value={current} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-[150px]">
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        <SelectValue>
          {(value) =>
            options.find((o) => o.value === value)?.label ?? "Select range"
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
