"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { ExternalLink, Loader2, MessageSquare, Send } from "lucide-react";
import { canSendSmsInApp, smsLead } from "@/lib/actions/leads";
import { smsSegments } from "@/lib/message-templates";
import { dialerSms, isDialerConfigured } from "@/components/app/ringcentral-dialer";
import { TemplatePicker, type LeadVars } from "@/components/app/template-picker";
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
import { cn } from "@/lib/utils";

/**
 * Write-and-send an SMS to one lead from the agent's own RingCentral (or
 * Dialpad) number — the same connection the softphone uses, so nothing is
 * typed into the embedded widget any more. Templates prefill the text; the
 * agent edits and sends. Logged on the lead as "SMS · sent".
 */
export function SmsComposeDialog({
  open,
  onOpenChange,
  leadId,
  lead,
  phone,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  lead: LeadVars;
  /** Lead phone as stored (E.164 preferred). */
  phone: string | null;
  /** Called once the SMS left and was logged on the lead. */
  onSent?: (eventId: string | null) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && (
          <ComposeBody
            leadId={leadId}
            lead={lead}
            phone={phone}
            onClose={() => onOpenChange(false)}
            onSent={onSent}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ComposeBody({
  leadId,
  lead,
  phone,
  onClose,
  onSent,
}: {
  leadId: string;
  lead: LeadVars;
  phone: string | null;
  onClose: () => void;
  onSent?: (eventId: string | null) => void;
}) {
  const [canSend, setCanSend] = useState<boolean | null>(null);
  const [text, setText] = useState("");
  const [sending, startSend] = useTransition();

  useEffect(() => {
    let active = true;
    canSendSmsInApp()
      .then((ok) => active && setCanSend(ok))
      .catch(() => active && setCanSend(false));
    return () => {
      active = false;
    };
  }, []);

  const seg = smsSegments(text);
  const ready = Boolean(canSend && phone && text.trim());

  const send = () =>
    startSend(async () => {
      const r = await smsLead(leadId, text);
      if (!r.ok) {
        toast.error(
          r.reason === "not_connected"
            ? "Connect RingCentral in Settings to send SMS from the platform."
            : r.reason === "bad_phone"
              ? "This lead's phone number isn't valid."
              : r.reason === "no_phone"
                ? "This lead has no phone number."
                : (r.message ?? "Couldn't send the SMS."),
        );
        return;
      }
      toast.success(`SMS sent to ${lead.name ?? "the lead"}.`);
      onClose();
      onSent?.(r.eventId ?? null);
    });

  // Last resort for agents who still use the embedded widget: hand the text over.
  const openInDialer = () => {
    if (!phone) return;
    if (!dialerSms(phone, text)) toast.error("Open the RingCentral dialer and sign in first.");
    else onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          SMS {lead.name}
        </DialogTitle>
        <DialogDescription>
          {phone ? (
            <>
              To <span className="font-medium text-foreground">{phone}</span>
              {canSend ? " · from your RingCentral number" : null}
            </>
          ) : (
            "This lead has no phone number."
          )}
        </DialogDescription>
      </DialogHeader>

      {!phone ? null : canSend === null ? (
        <p className="flex items-center gap-1.5 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking your phone connection…
        </p>
      ) : (
        <div className="space-y-3">
          {!canSend && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
              Your RingCentral isn&apos;t connected to the platform yet, so this can
              only be sent through the dialer. Connect it in Settings → Phone to
              send from here.
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <TemplatePicker
              channel="sms"
              lead={lead}
              onPick={(f) => setText(f.body)}
            />
            <span
              className={cn(
                "text-xs text-muted-foreground",
                seg.segments > 3 && "text-amber-600 dark:text-amber-400",
              )}
            >
              {seg.chars} chars · {seg.segments} SMS
              {seg.unicode ? " · special characters" : ""}
            </span>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1600}
            rows={7}
            autoFocus
            className={cn(
              "w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors",
              "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
            )}
            placeholder="Write your message…"
          />
        </div>
      )}

      <DialogFooter className="flex-wrap gap-2 sm:justify-between">
        {isDialerConfigured ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={!phone}
            onClick={openInDialer}
            title="Hand the text to the embedded RingCentral dialer instead"
          >
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            Open in dialer
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <DialogClose
            render={
              <Button variant="ghost" size="sm">
                Cancel
              </Button>
            }
          />
          {canSend && (
            <Button size="sm" disabled={!ready || sending} onClick={send}>
              {sending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="mr-1.5 h-3.5 w-3.5" />
              )}
              Send SMS
            </Button>
          )}
        </div>
      </DialogFooter>
    </>
  );
}
