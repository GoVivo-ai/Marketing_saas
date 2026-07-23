"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { format } from "date-fns";
import { CalendarClock, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { setMaintenanceMode, type DevActionState } from "@/lib/actions/dev";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** ISO → the local-time string a datetime-local input expects. */
const toLocalInput = (iso: string | null) =>
  iso ? format(new Date(iso), "yyyy-MM-dd'T'HH:mm") : "";

export function DevMaintenanceForm({
  enabled,
  message,
  scheduledStart,
  scheduledEnd,
}: {
  enabled: boolean;
  message: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
}) {
  const [checked, setChecked] = useState(enabled);
  const [state, action, pending] = useActionState<DevActionState, FormData>(
    setMaintenanceMode,
    {},
  );
  const [, startSubmit] = useTransition();

  useEffect(() => {
    if (state.error) toast.error(state.error);
    else if (state.success) toast.success(state.success);
  }, [state]);

  return (
    // The action is dispatched manually so React 19's automatic form reset
    // doesn't blank the controlled checkbox after a save.
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        // datetime-local values are local wall time — normalize to ISO/UTC so
        // the server stores an unambiguous instant.
        for (const field of ["scheduledStart", "scheduledEnd"] as const) {
          const raw = String(data.get(field) ?? "").trim();
          data.set(field, raw ? new Date(raw).toISOString() : "");
        }
        startSubmit(() => action(data));
      }}
      className="space-y-4"
    >
      <label
        className={cn(
          "flex cursor-pointer items-center justify-between rounded-lg border p-4 transition-colors",
          checked && "border-amber-500/60 bg-amber-500/10",
        )}
      >
        <span className="flex items-center gap-2.5">
          <TriangleAlert
            className={cn(
              "h-4 w-4",
              checked ? "text-amber-500" : "text-muted-foreground",
            )}
          />
          <span>
            <span className="block text-sm font-medium">Maintenance mode</span>
            <span className="block text-xs text-muted-foreground">
              Everyone except developers gets the maintenance screen.
            </span>
          </span>
        </span>
        <input
          type="checkbox"
          name="enabled"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="h-4 w-4 accent-amber-500"
        />
      </label>
      <div className="space-y-2">
        <Label htmlFor="mnt-message">Message shown to users (optional)</Label>
        <Input
          id="mnt-message"
          name="message"
          defaultValue={message ?? ""}
          placeholder="We're doing scheduled maintenance — back shortly."
          maxLength={500}
        />
      </div>

      {/* Scheduled window — turns itself on at start and back off at end. */}
      <div className="space-y-2 rounded-lg border p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          Scheduled window (optional)
        </p>
        <p className="text-xs text-muted-foreground">
          Maintenance starts and ends automatically — no need to come back and
          flip the switch. Clear both fields to cancel it. Times are your local
          timezone.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="mnt-start" className="text-xs">
              From
            </Label>
            <Input
              id="mnt-start"
              name="scheduledStart"
              type="datetime-local"
              defaultValue={toLocalInput(scheduledStart)}
              className="text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mnt-end" className="text-xs">
              Until
            </Label>
            <Input
              id="mnt-end"
              name="scheduledEnd"
              type="datetime-local"
              defaultValue={toLocalInput(scheduledEnd)}
              className="text-sm"
            />
          </div>
        </div>
      </div>
      <div className="flex justify-end">
        <Button size="sm" type="submit" disabled={pending}>
          {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </form>
  );
}
