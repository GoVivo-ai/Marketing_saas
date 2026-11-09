"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { ExternalLink, Loader2, Mail, Plug, Send } from "lucide-react";
import { getMyMailAccount, type MyMailAccount } from "@/lib/actions/mail";
import { sendLeadEmail } from "@/lib/actions/leads";
import { MAIL_PROVIDER_LABEL, type MailProvider } from "@/lib/integrations/mail";
import { useMailConnectToast } from "@/components/app/mail-connect-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

/** Where to come back to after the OAuth round-trip: this very page. */
function connectHref(provider: MailProvider) {
  const here = window.location.pathname + window.location.search;
  return `/api/mail/${provider}/start?return=${encodeURIComponent(here)}`;
}

function firstName(full: string) {
  return full.trim().split(/\s+/)[0] ?? "";
}

/**
 * Compose-and-send for one lead, from the agent's own Gmail/Outlook. When
 * nothing is connected yet the same dialog offers the Connect buttons and,
 * as a last resort, the old "open your mail app" link — nobody is left
 * without a way to write to the lead.
 */
export function EmailComposeDialog({
  open,
  onOpenChange,
  leadId,
  leadName,
  to,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  leadName: string;
  to: string | null;
  /** Called once the email left and was logged on the lead. */
  onSent?: (eventId: string | null) => void;
}) {
  useMailConnectToast();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* Mounted fresh on every open: state resets and the account is
            re-read (the agent may have just connected a mailbox). */}
        {open && (
          <ComposeBody
            leadId={leadId}
            leadName={leadName}
            to={to}
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
  leadName,
  to,
  onClose,
  onSent,
}: {
  leadId: string;
  leadName: string;
  to: string | null;
  onClose: () => void;
  onSent?: (eventId: string | null) => void;
}) {
  const [me, setMe] = useState<MyMailAccount | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, startSend] = useTransition();

  useEffect(() => {
    let active = true;
    getMyMailAccount()
      .then((m) => {
        if (!active) return;
        setMe(m);
        const greet = firstName(leadName);
        setBody(
          `Hi${greet ? ` ${greet}` : ""},\n\n\n\nBest regards,\n${m.userName ?? ""}`.trimEnd() + "\n",
        );
      })
      .catch((e: unknown) => {
        if (active) setLoadError(e instanceof Error ? e.message : "Couldn't load your email account.");
      });
    return () => {
      active = false;
    };
  }, [leadName]);

  const canSend = Boolean(me?.account && to && subject.trim() && body.trim());

  const send = () =>
    startSend(async () => {
      const r = await sendLeadEmail(leadId, { subject, body });
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      toast.success(`Email sent to ${leadName}.`);
      onClose();
      onSent?.(r.eventId ?? null);
    });

  const openMailApp = () => {
    if (to) window.location.href = `mailto:${to}`;
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" />
          Email {leadName}
        </DialogTitle>
        <DialogDescription>
          {to ? (
            <>
              To <span className="font-medium text-foreground">{to}</span>
              {me?.account ? (
                <>
                  {" "}
                  · from {me.account.address} ({MAIL_PROVIDER_LABEL[me.account.provider]})
                </>
              ) : null}
            </>
          ) : (
            "This lead has no email address."
          )}
        </DialogDescription>
      </DialogHeader>

      {!to ? null : me === null && !loadError ? (
        <p className="flex items-center gap-1.5 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking your email account…
        </p>
      ) : loadError ? (
        <p className="py-2 text-sm text-destructive">{loadError}</p>
      ) : me && !me.account ? (
        /* Nothing connected yet — connect here, no trip to Settings needed. */
        <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
          <p className="text-sm">
            Connect your email once and send to leads without leaving the
            queue. Replies land in your own inbox and every email you send is
            logged on the lead.
          </p>
          {me.providers.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {me.providers.map((p) => (
                <Button key={p} size="sm" render={<a href={connectHref(p)} />}>
                  <Plug className="mr-1.5 h-3.5 w-3.5" />
                  Connect {MAIL_PROVIDER_LABEL[p]}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-destructive">
              No email provider is configured on this server yet.
            </p>
          )}
        </div>
      ) : me?.account ? (
        <div className="space-y-3">
          {me.account.lastError && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
              Last attempt failed: {me.account.lastError}
            </p>
          )}
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            maxLength={200}
            autoFocus
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={10_000}
            rows={10}
            className={cn(
              "w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors",
              "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
            )}
            placeholder="Write your email…"
          />
        </div>
      ) : null}

      <DialogFooter className="flex-wrap gap-2 sm:justify-between">
        <Button
          variant="ghost"
          size="sm"
          disabled={!to}
          onClick={openMailApp}
          title="Open your default mail app instead"
        >
          <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
          Open in mail app
        </Button>
        <div className="flex gap-2">
          <DialogClose
            render={
              <Button variant="ghost" size="sm">
                Cancel
              </Button>
            }
          />
          {me?.account && (
            <Button size="sm" disabled={!canSend || sending} onClick={send}>
              {sending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="mr-1.5 h-3.5 w-3.5" />
              )}
              Send
            </Button>
          )}
        </div>
      </DialogFooter>
    </>
  );
}
