"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PhoneCall, MessageSquare, Mail } from "lucide-react";
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
  email,
}: {
  /** Lead phone in E.164 (e.g. +57…); the dialer places the call in-browser. */
  phone: string | null;
  hasPhone: boolean;
  /** Lead email; the Email button opens the user's mail client (e.g. Outlook). */
  email?: string | null;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const address = email && email !== "—" ? email : null;

  // Email doesn't need the dialer — a mailto: link opens the default mail
  // client (Outlook et al.) with the lead's address ready to go.
  const emailButton = (
    <Button
      size="sm"
      variant="outline"
      disabled={!address}
      onClick={() => {
        if (address) window.location.href = `mailto:${address}`;
      }}
    >
      <Mail className="mr-1 h-3.5 w-3.5" />
      Email
    </Button>
  );

  if (!isDialerConfigured) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">{emailButton}</div>
        <p className="text-xs text-muted-foreground">
          The in-app dialer isn&apos;t configured yet.
        </p>
      </div>
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
      {emailButton}

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
