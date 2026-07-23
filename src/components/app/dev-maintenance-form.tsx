"use client";

import { useActionState, useEffect, useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { setMaintenanceMode, type DevActionState } from "@/lib/actions/dev";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function DevMaintenanceForm({
  enabled,
  message,
}: {
  enabled: boolean;
  message: string | null;
}) {
  const [checked, setChecked] = useState(enabled);
  const [state, action, pending] = useActionState<DevActionState, FormData>(
    setMaintenanceMode,
    {},
  );

  useEffect(() => {
    if (state.error) toast.error(state.error);
    else if (state.success) toast.success(state.success);
  }, [state]);

  return (
    <form action={action} className="space-y-4">
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
      <div className="flex justify-end">
        <Button size="sm" disabled={pending}>
          {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </form>
  );
}
