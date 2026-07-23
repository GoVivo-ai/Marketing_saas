"use client";

import { useActionState, useState } from "react";
import { LifeBuoy, Loader2, CircleCheck } from "lucide-react";
import {
  createSupportTicket,
  type SupportTicketState,
} from "@/lib/actions/support";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  { value: "bug", label: "Bug / something broken" },
  { value: "feature_request", label: "Feature request" },
  { value: "access", label: "Access / login" },
  { value: "data", label: "Data issue" },
  { value: "other", label: "Other" },
];
const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

const initial: SupportTicketState = {};

/**
 * Sidebar "Support" entry: opens a ticket form wired to the Vivo Assistant.
 * The reporter gets the confirmation and all follow-ups by Slack DM, exactly
 * like tickets opened in the assistant's chat.
 */
export function SupportDialog() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("bug");
  const [priority, setPriority] = useState("medium");
  const [state, action, pending] = useActionState(createSupportTicket, initial);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <LifeBuoy className="h-4 w-4" />
            Support
          </button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open a support ticket</DialogTitle>
          <DialogDescription>
            It goes straight to the Vivo Assistant — you&apos;ll get the
            confirmation and all updates by Slack DM.
          </DialogDescription>
        </DialogHeader>
        {state.success ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CircleCheck className="h-9 w-9 text-success" />
            <p className="font-medium">{state.success}</p>
          </div>
        ) : (
          <form action={action} className="space-y-4">
            <input type="hidden" name="category" value={category} />
            <input type="hidden" name="priority" value={priority} />
            <div className="space-y-2">
              <Label htmlFor="st-title">Subject</Label>
              <Input
                id="st-title"
                name="title"
                maxLength={120}
                placeholder="Short summary of the issue…"
                required
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={category} onValueChange={(v) => v && setCategory(v)}>
                  <SelectTrigger className="w-full" aria-label="Category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={priority} onValueChange={(v) => v && setPriority(v)}>
                  <SelectTrigger className="w-full" aria-label="Priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="st-description">Description</Label>
              <textarea
                id="st-description"
                name="description"
                rows={5}
                maxLength={4000}
                required
                placeholder="What happened? What did you expect? Steps to reproduce…"
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
              />
            </div>
            {state.error && (
              <p className="text-sm text-destructive">{state.error}</p>
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
                {pending ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : null}
                Open ticket
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
