"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getLeadStages, moveLeadToStage } from "@/lib/actions/leads";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { LeadRow } from "@/lib/data";

type StageOption = { id: string; name: string; color: string | null; kind: string };

/**
 * The stage badge in the lead detail header, clickable: opens the list of the
 * workspace's stages and moves the lead to the chosen one — same write path
 * as dragging the card on the pipeline board.
 */
export function LeadStagePicker({
  lead,
  onPatch,
}: {
  lead: LeadRow;
  onPatch?: (patch: Partial<LeadRow>) => void;
}) {
  const router = useRouter();
  const [stages, setStages] = useState<StageOption[] | null>(null);
  const [loading, startLoad] = useTransition();
  const [moving, startMove] = useTransition();

  // Stages load lazily on first open — most detail views never change stage.
  const onOpenChange = (open: boolean) => {
    if (!open || stages) return;
    startLoad(async () => {
      try {
        setStages(await getLeadStages(lead.id));
      } catch {
        toast.error("Couldn't load the stages.");
      }
    });
  };

  const move = (st: StageOption) => {
    if (st.id === lead.stageId) return;
    startMove(async () => {
      const res = await moveLeadToStage(lead.id, st.id);
      if (!res.ok) {
        toast.error(res.message ?? "Couldn't move the lead.");
        return;
      }
      onPatch?.({ stageId: st.id, stageName: st.name, stageColor: st.color });
      toast.success(`Moved to ${st.name}.`);
      router.refresh();
    });
  };

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        title="Change stage"
        aria-label="Change stage"
        disabled={moving}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60"
      >
        {moving ? (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        ) : (
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: lead.stageColor ?? "#94a3b8" }}
          />
        )}
        {lead.stageName ?? lead.status}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[340px] w-60 overflow-auto">
        {loading || !stages ? (
          <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading stages…
          </div>
        ) : (
          stages.map((st) => (
            <DropdownMenuItem key={st.id} onClick={() => move(st)}>
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: st.color ?? "#94a3b8" }}
              />
              <span className="flex-1 truncate">{st.name}</span>
              {lead.stageId === st.id && <Check className="ml-2 h-4 w-4 shrink-0" />}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
