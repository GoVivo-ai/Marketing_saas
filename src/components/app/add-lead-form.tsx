"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Loader2, UserPlus } from "lucide-react";
import { createManualLead, type ManualLeadState } from "@/lib/actions/leads";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const initial: ManualLeadState = {};

/**
 * "Add lead" entry point for leads that don't come from an ad platform —
 * direct referrals, walk-ins, phone-ins. Complements the Meta sync.
 */
export function AddLeadDialog({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Close on success and refresh the list so the new lead shows up right away.
  const [state, action, pending] = useActionState(
    async (prev: ManualLeadState, formData: FormData) => {
      const result = await createManualLead(prev, formData);
      if (result.success) {
        setOpen(false);
        router.refresh();
      }
      return result;
    },
    initial,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm">
            <UserPlus className="mr-1.5 h-3.5 w-3.5" />
            Add lead
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a lead manually</DialogTitle>
          <DialogDescription>
            For leads that don&apos;t come from an ad — direct referrals,
            walk-ins, phone-ins. It lands in the first stage of the pipeline.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ml-first-name">First name</Label>
              <Input id="ml-first-name" name="firstName" placeholder="Jane" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ml-last-name">Last name</Label>
              <Input id="ml-last-name" name="lastName" placeholder="Pérez" required />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ml-phone">Phone</Label>
              <Input id="ml-phone" name="phone" type="tel" placeholder="+1 305 555 0123" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ml-email">Email</Label>
              <Input id="ml-email" name="email" type="email" placeholder="jane@example.com" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ml-city">City</Label>
            <Input id="ml-city" name="city" placeholder="Miami, FL" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ml-note">Note</Label>
            <Input
              id="ml-note"
              name="note"
              maxLength={2000}
              placeholder="Referred by an existing driver…"
            />
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          {state.success && (
            <p className="flex items-center gap-1 text-sm text-success">
              <CircleCheck className="h-4 w-4" />
              {state.success}
            </p>
          )}
          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="ghost" size="sm">
                  Cancel
                </Button>
              }
            />
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Add lead
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
