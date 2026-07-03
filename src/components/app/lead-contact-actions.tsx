"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PhoneCall, MessageSquare } from "lucide-react";
import {
  dialerCall,
  dialerSms,
  isDialerConfigured,
} from "@/components/app/ringcentral-dialer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const NEEDS_DIALER =
  "Open the RingCentral dialer (bottom-right) and sign in first.";

export function LeadContactActions({
  phone,
  hasPhone,
}: {
  /** Lead phone in E.164 (e.g. +57…); the dialer places the call in-browser. */
  phone: string | null;
  hasPhone: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!isDialerConfigured) {
    return (
      <p className="text-xs text-muted-foreground">
        The in-app dialer isn&apos;t configured yet.
      </p>
    );
  }

  const number = phone && phone !== "—" ? phone : null;

  const placeCall = () => {
    if (!number) return;
    setConfirmOpen(false);
    if (!dialerCall(number)) toast.error(NEEDS_DIALER);
  };

  const onSms = () => {
    if (!number) return;
    if (!dialerSms(number)) toast.error(NEEDS_DIALER);
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={!hasPhone || !number}
        onClick={() => setConfirmOpen(true)}
      >
        <PhoneCall className="mr-1 h-3.5 w-3.5" />
        Call
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!hasPhone || !number}
        onClick={onSms}
      >
        <MessageSquare className="mr-1 h-3.5 w-3.5" />
        SMS
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Call this lead?</DialogTitle>
            <DialogDescription>
              The dialer will call{" "}
              <span className="font-medium text-foreground">{number}</span>{" "}
              right away, through your browser.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose
              render={
                <Button variant="ghost" size="sm">
                  Cancel
                </Button>
              }
            />
            <Button size="sm" onClick={placeCall}>
              <PhoneCall className="mr-1 h-3.5 w-3.5" />
              Call now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
