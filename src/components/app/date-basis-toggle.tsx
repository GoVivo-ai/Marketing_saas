"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarPlus, ArrowRightLeft, Check, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { PipelineDateBasis } from "@/lib/data";

const OPTIONS: {
  value: PipelineDateBasis;
  label: string;
  hint: string;
}[] = [
  {
    value: "created",
    label: "Created",
    hint: "When the lead came in",
  },
  {
    value: "stage",
    label: "Entered stage",
    hint: "When it was moved into its current column",
  },
];

/**
 * What the pipeline's date window applies to. Sits in front of the date
 * picker and writes `?by=stage` (absent = created) so the server re-slices.
 * "Entered stage" answers "what did the team move on this date" — the ask
 * from the ops meeting, where a created-date filter showed nothing in
 * Contractor Compliance for a day the team had clearly worked.
 */
export function DateBasisToggle({ value }: { value: PipelineDateBasis }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const select = (next: PipelineDateBasis) => {
    if (next === value) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next === "created") params.delete("by");
    else params.set("by", next);
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  };

  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0];
  const Icon = value === "stage" ? ArrowRightLeft : CalendarPlus;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 px-2 text-xs font-medium text-muted-foreground"
            title={current.hint}
          />
        }
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Icon className="h-3.5 w-3.5" />
        )}
        {current.label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {OPTIONS.map((o) => (
          <DropdownMenuItem
            key={o.value}
            onClick={() => select(o.value)}
            className="flex items-start gap-2"
          >
            <Check
              className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                o.value === value ? "opacity-100" : "opacity-0"
              }`}
            />
            <span className="flex flex-col">
              <span className="text-sm">{o.label}</span>
              <span className="text-xs text-muted-foreground">{o.hint}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
