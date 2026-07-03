"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Ban, X } from "lucide-react";
import { toast } from "sonner";
import { setLeadDisqual, clearLeadDisqual } from "@/lib/actions/leads";
import {
  RCA_LEVEL1,
  rcaLevel2,
  rcaLevel3,
  isValidRcaPath,
} from "@/lib/rca";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Captures the RCA disqualification reason (Lvl 1 → 2 → 3) for a lost /
 * not-qualified lead — the spreadsheet's RCA columns, as cascading selects.
 *
 * The Contact Queue records the reason in the hot path (right after a
 * terminal call outcome), so here the form stays collapsed behind a
 * "Mark as lost" button; the panel is for reviewing, completing deferred
 * reasons and corrections.
 */
export function LeadDisqualify({
  leadId,
  current,
}: {
  leadId: string;
  current: { l1: string | null; l2: string | null; l3: string | null };
}) {
  const router = useRouter();
  const [l1, setL1] = useState(current.l1 ?? "");
  const [l2, setL2] = useState(current.l2 ?? "");
  const [l3, setL3] = useState(current.l3 ?? "");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, startSave] = useTransition();
  const [clearing, startClear] = useTransition();

  const hasReason = current.l1 != null;
  const valid = isValidRcaPath(l1, l2, l3);

  const onL1 = (v: string) => {
    setL1(v);
    setL2("");
    setL3("");
  };
  const onL2 = (v: string) => {
    setL2(v);
    setL3("");
  };

  const onSave = () =>
    startSave(async () => {
      const r = await setLeadDisqual(leadId, { l1, l2, l3, note });
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      setNote("");
      setEditing(false);
      toast.success("Disqualification reason saved.");
      router.refresh();
    });

  const onClear = () =>
    startClear(async () => {
      const r = await clearLeadDisqual(leadId);
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      setL1("");
      setL2("");
      setL3("");
      toast.success("Reason cleared.");
      router.refresh();
    });

  // Collapsed by default: a reason summary when one exists, a quiet
  // "Mark as lost" entry point when none. The selects only show on demand.
  if (!editing) {
    return (
      <div className="space-y-2">
        {hasReason ? (
          <>
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Disqualification reason
              </h4>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => setEditing(true)}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  disabled={clearing}
                  onClick={onClear}
                >
                  {clearing ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <X className="mr-1 h-3.5 w-3.5" />
                  )}
                  Clear
                </Button>
              </div>
            </div>
            <p className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {[current.l1, current.l2, current.l3].filter(Boolean).join(" › ")}
              </span>
            </p>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => setEditing(true)}
          >
            <Ban className="mr-1 h-3.5 w-3.5" />
            Mark as lost…
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Disqualification reason
        </h4>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
      </div>

      <Select value={l1} onValueChange={(v) => v && onL1(v)}>
        <SelectTrigger className="h-8 text-xs" aria-label="Driver">
          <SelectValue placeholder="Driver…" />
        </SelectTrigger>
        <SelectContent>
          {RCA_LEVEL1.map((v) => (
            <SelectItem key={v} value={v}>
              {v}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={l2} onValueChange={(v) => v && onL2(v)} disabled={!l1}>
        <SelectTrigger className="h-8 text-xs" aria-label="Category">
          <SelectValue placeholder="Category…" />
        </SelectTrigger>
        <SelectContent>
          {rcaLevel2(l1).map((v) => (
            <SelectItem key={v} value={v}>
              {v}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={l3} onValueChange={(v) => v && setL3(v)} disabled={!l2}>
        <SelectTrigger className="h-8 text-xs" aria-label="Reason">
          <SelectValue placeholder="Reason…" />
        </SelectTrigger>
        <SelectContent>
          {rcaLevel3(l1, l2).map((v) => (
            <SelectItem key={v} value={v}>
              {v}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional detail…"
        maxLength={2000}
        className="h-8 text-xs"
      />

      <div className="flex justify-end">
        <Button size="sm" className="h-8" disabled={!valid || saving} onClick={onSave}>
          {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          Save reason
        </Button>
      </div>
    </div>
  );
}
