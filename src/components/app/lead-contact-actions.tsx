"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PhoneCall, MessageSquare, Loader2, Send } from "lucide-react";
import { callLead, smsLead, type LeadContactResult } from "@/lib/actions/leads";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function report(r: LeadContactResult, okText: string) {
  if (r.ok) return toast.success(okText);
  switch (r.reason) {
    case "no_phone":
      return toast.error("This lead has no phone number.");
    case "bad_phone":
      return toast.error("The lead's phone number isn't valid (need E.164, e.g. +57…).");
    case "not_connected":
      return toast.error("Connect RingCentral in Settings first.", {
        action: {
          label: "Settings",
          onClick: () => {
            window.location.href = "/settings/general";
          },
        },
      });
    default:
      return toast.error(r.message ?? "Something went wrong.");
  }
}

export function LeadContactActions({
  leadId,
  hasPhone,
  connected,
}: {
  leadId: string;
  hasPhone: boolean;
  connected: boolean;
}) {
  const [calling, startCall] = useTransition();
  const [sending, startSms] = useTransition();
  const [smsOpen, setSmsOpen] = useState(false);
  const [text, setText] = useState("");

  if (!connected) {
    return (
      <p className="text-xs text-muted-foreground">
        <a href="/settings/general" className="underline">
          Connect RingCentral
        </a>{" "}
        to call or text leads from here.
      </p>
    );
  }

  const onCall = () =>
    startCall(async () => {
      const r = await callLead(leadId);
      report(r, "Calling — your RingCentral phone will ring, then the lead.");
    });

  const onSend = () =>
    startSms(async () => {
      const r = await smsLead(leadId, text);
      report(r, "SMS sent.");
      if (r.ok) {
        setText("");
        setSmsOpen(false);
      }
    });

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={!hasPhone || calling}
        onClick={onCall}
      >
        {calling ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : (
          <PhoneCall className="mr-1 h-3.5 w-3.5" />
        )}
        Call
      </Button>

      <Dialog open={smsOpen} onOpenChange={setSmsOpen}>
        <DialogTrigger
          render={
            <Button size="sm" variant="outline" disabled={!hasPhone}>
              <MessageSquare className="mr-1 h-3.5 w-3.5" />
              SMS
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send SMS</DialogTitle>
            <DialogDescription>
              Sent from your RingCentral number to the lead.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="sms-text">Message</Label>
            <Input
              id="sms-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Hi, thanks for your interest…"
              maxLength={1000}
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" size="sm">Cancel</Button>} />
            <Button size="sm" disabled={!text.trim() || sending} onClick={onSend}>
              {sending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="mr-1 h-3.5 w-3.5" />
              )}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
