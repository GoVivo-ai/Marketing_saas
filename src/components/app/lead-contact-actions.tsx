"use client";

import { useState } from "react";
import { PhoneCall, MessageSquare, Mail } from "lucide-react";
import { useDialNumber } from "@/components/app/softphone";
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
import { SmsComposeDialog } from "@/components/app/sms-compose-dialog";

export function LeadContactActions({
  leadId,
  leadName,
  phone,
  hasPhone,
  email,
  city,
  state,
  campaign,
}: {
  leadId: string;
  leadName: string;
  /** Lead phone in E.164 (e.g. +57…); the dialer places the call in-browser. */
  phone: string | null;
  hasPhone: boolean;
  /** Lead email; the Email button composes from the user's own Gmail/Outlook. */
  email?: string | null;
  /** For message-template placeholders ({city}, {campaign}, …). */
  city?: string | null;
  state?: string | null;
  campaign?: string | null;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);
  const dialNumber = useDialNumber();
  const leadVars = { name: leadName, city, state, campaign };
  const refreshActivity = () =>
    // The Activity timeline lives in a sibling; nudge it to reload.
    window.dispatchEvent(new CustomEvent("lead-activity:refresh", { detail: { leadId } }));

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
        lead={leadVars}
        onSent={refreshActivity}
      />
    </>
  );

  const number = phone && phone !== "—" ? phone : null;

  // SMS goes out from the agent's own connected RingCentral/Dialpad number
  // (the Vivo phone's connection).
  const smsButton = (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={!hasPhone || !number}
        onClick={() => setSmsOpen(true)}
      >
        <MessageSquare className="mr-1 h-3.5 w-3.5" />
        SMS
      </Button>
      <SmsComposeDialog
        open={smsOpen}
        onOpenChange={setSmsOpen}
        leadId={leadId}
        lead={leadVars}
        phone={number}
        onSent={refreshActivity}
      />
    </>
  );

  // Calls go through the Vivo phone (it opens on its Connect screen when no
  // RingCentral is connected yet).
  const placeCall = () => {
    if (!number) return;
    setConfirmOpen(false);
    dialNumber(number);
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
      {smsButton}
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
