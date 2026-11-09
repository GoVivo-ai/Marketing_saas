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
import { EmailComposeDialog } from "@/components/app/email-compose-dialog";

const NEEDS_DIALER =
  "Open the RingCentral dialer (bottom-right) and sign in first.";

export function LeadContactActions({
  leadId,
  leadName,
  phone,
  hasPhone,
  email,
}: {
  leadId: string;
  leadName: string;
  /** Lead phone in E.164 (e.g. +57…); the dialer places the call in-browser. */
  phone: string | null;
  hasPhone: boolean;
  /** Lead email; the Email button composes from the user's own Gmail/Outlook. */
  email?: string | null;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);

  const address = email && email !== "—" ? email : null;

  // Email doesn't need the dialer — it goes out from the agent's connected
  // mailbox (the dialog handles connecting one, or falls back to mailto:).
  const emailButton = (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={!address}
        onClick={() => setComposeOpen(true)}
      >
        <Mail className="mr-1 h-3.5 w-3.5" />
        Email
      </Button>
      <EmailComposeDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        leadId={leadId}
        leadName={leadName}
        to={address}
        onSent={() =>
          // The Activity timeline lives in a sibling; nudge it to reload.
          window.dispatchEvent(new CustomEvent("lead-activity:refresh", { detail: { leadId } }))
        }
      />
    </>
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
