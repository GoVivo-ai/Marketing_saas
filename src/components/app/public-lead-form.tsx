"use client";

import { useActionState } from "react";
import { CircleCheck, Loader2 } from "lucide-react";
import { createPublicLead, type ManualLeadState } from "@/lib/actions/leads";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: ManualLeadState = {};

/**
 * The public /join/<slug> application form. Same fields as the internal
 * Add-lead dialog minus the note, plus a honeypot ("website") that stays
 * hidden from humans — bots that fill it are silently dropped server-side.
 */
export function PublicLeadForm({
  workspaceSlug,
  accent,
}: {
  workspaceSlug: string;
  accent: string;
}) {
  const [state, action, pending] = useActionState(createPublicLead, initial);

  if (state.success) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <CircleCheck className="h-10 w-10" style={{ color: accent }} />
        <p className="font-medium">{state.success}</p>
        <p className="text-sm text-muted-foreground">
          Our team will reach out by phone, SMS or email.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      {/* Honeypot — hidden from humans, tempting for bots. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="pl-first-name">First name</Label>
          <Input id="pl-first-name" name="firstName" placeholder="Jane" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pl-last-name">Last name</Label>
          <Input id="pl-last-name" name="lastName" placeholder="Pérez" required />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="pl-phone">Phone</Label>
        <Input id="pl-phone" name="phone" type="tel" placeholder="+1 305 555 0123" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="pl-email">Email</Label>
        <Input id="pl-email" name="email" type="email" placeholder="jane@example.com" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="pl-city">City</Label>
          <Input id="pl-city" name="city" placeholder="Miami" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pl-state">State</Label>
          <Input id="pl-state" name="state" placeholder="Florida" />
        </div>
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button
        type="submit"
        className="w-full text-white"
        style={{ backgroundColor: accent }}
        disabled={pending}
      >
        {pending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
        Apply now
      </Button>
    </form>
  );
}
