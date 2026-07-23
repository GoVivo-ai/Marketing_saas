"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  PhoneCall,
  MessageSquare,
  Mail,
  MessageCircle,
  StickyNote,
  ArrowRight,
  Ban,
  Loader2,
  Send,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import {
  getLeadActivity,
  addLeadNote,
  logLeadOutreach,
  setLeadDisqual,
} from "@/lib/actions/leads";
import {
  DISQUAL_PREFILL,
  OUTREACH_CHANNELS,
  OUTREACH_OUTCOMES,
  type LeadActivityItem,
  type OutreachChannel,
  type OutreachOutcome,
} from "@/lib/outreach";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const CHANNEL_LABEL: Record<OutreachChannel, string> = {
  call: "Call",
  sms: "SMS",
  email: "Email",
  whatsapp: "WhatsApp",
};

const OUTCOME_LABEL: Record<OutreachOutcome, string> = {
  answered: "Answered",
  no_answer: "No answer",
  voicemail: "Voicemail",
  replied: "Replied",
  sent: "Email / SMS sent",
  not_interested: "Not interested",
  wrong_number: "Wrong number",
};

/** Outcome → badge tone, so the timeline reads at a glance. */
const OUTCOME_TONE: Record<OutreachOutcome, string> = {
  answered: "text-success",
  replied: "text-success",
  voicemail: "text-amber-500",
  no_answer: "text-amber-500",
  sent: "text-sky-500",
  not_interested: "text-destructive",
  wrong_number: "text-destructive",
};

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  call: PhoneCall,
  sms: MessageSquare,
  email: Mail,
  whatsapp: MessageCircle,
  note: StickyNote,
  status_change: ArrowRight,
  disqualified: Ban,
};

function eventTitle(item: LeadActivityItem): string {
  if (item.type === "note") return "Note";
  if (item.type === "status_change") return item.text ?? "Stage changed";
  if (item.type === "disqualified") return "Disqualified";
  const channel = CHANNEL_LABEL[item.type as OutreachChannel] ?? item.type;
  const outcome = item.outcome ? OUTCOME_LABEL[item.outcome] : null;
  const prefix = item.manual ? channel : `${channel} (platform)`;
  return outcome ? `${prefix} · ${outcome}` : prefix;
}

export function LeadActivity({ leadId }: { leadId: string }) {
  const [items, setItems] = useState<LeadActivityItem[] | null>(null);
  const [note, setNote] = useState("");
  const [channel, setChannel] = useState<OutreachChannel>("call");
  const [outcome, setOutcome] = useState<OutreachOutcome>("no_answer");
  const [outreachNote, setOutreachNote] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [savingNote, startNote] = useTransition();
  const [logging, startLog] = useTransition();

  const load = useCallback(async () => {
    const data = await getLeadActivity(leadId);
    setItems(data);
  }, [leadId]);

  // The detail panel remounts this component per lead (key={lead.id}), so the
  // history only needs to load once on mount. setItems runs after the await,
  // so this doesn't cascade renders.
  useEffect(() => {
    let active = true;
    getLeadActivity(leadId).then((data) => {
      if (active) setItems(data);
    });
    return () => {
      active = false;
    };
  }, [leadId]);

  const onAddNote = () =>
    startNote(async () => {
      const r = await addLeadNote(leadId, note);
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      setNote("");
      toast.success("Note added.");
      await load();
    });

  const onLog = () =>
    startLog(async () => {
      const r = await logLeadOutreach(leadId, {
        channel,
        outcome,
        note: outreachNote,
      });
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      // Same flow as the Contact Queue: a terminal outcome also records the
      // most likely RCA reason and moves the lead to Lost (editable later
      // from the Disqualify tab).
      const prefill = DISQUAL_PREFILL[outcome];
      if (prefill) {
        const d = await setLeadDisqual(leadId, prefill);
        if (!d.ok) toast.error(d.message);
      }
      setOutreachNote("");
      setShowLog(false);
      toast.success(
        prefill
          ? `Outreach logged — marked ${OUTCOME_LABEL[outcome]} (reason editable in Disqualify).`
          : "Outreach logged.",
      );
      await load();
    });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Activity
        </h4>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => setShowLog((v) => !v)}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Log outreach
        </Button>
      </div>

      {/* Log a contact attempt — the spreadsheet's outreach columns. */}
      {showLog && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <div className="flex flex-wrap gap-2">
            <Select
              value={channel}
              onValueChange={(v) => v && setChannel(v as OutreachChannel)}
            >
              <SelectTrigger className="h-8 w-28 text-xs" aria-label="Channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OUTREACH_CHANNELS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CHANNEL_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={outcome}
              onValueChange={(v) => v && setOutcome(v as OutreachOutcome)}
            >
              <SelectTrigger className="h-8 w-36 text-xs" aria-label="Outcome">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OUTREACH_OUTCOMES.map((o) => (
                  <SelectItem key={o} value={o}>
                    {OUTCOME_LABEL[o]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input
            value={outreachNote}
            onChange={(e) => setOutreachNote(e.target.value)}
            placeholder="Optional comment…"
            maxLength={2000}
            className="h-8 text-xs"
          />
          <div className="flex justify-end">
            <Button size="sm" className="h-8" disabled={logging} onClick={onLog}>
              {logging ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Log
            </Button>
          </div>
        </div>
      )}

      {/* Quick note. */}
      <div className="flex gap-2">
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && note.trim() && !savingNote) onAddNote();
          }}
          placeholder="Add a note…"
          maxLength={2000}
          className="h-8 text-sm"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-8 shrink-0"
          disabled={!note.trim() || savingNote}
          onClick={onAddNote}
        >
          {savingNote ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      {/* Timeline. */}
      {items === null ? (
        <p className="flex items-center gap-1.5 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </p>
      ) : items.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          No activity yet. Log a call, text or note to start the history.
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const Icon = TYPE_ICON[item.type] ?? StickyNote;
            const tone =
              item.outcome != null ? OUTCOME_TONE[item.outcome] : undefined;
            return (
              <li key={item.id} className="flex gap-2.5 text-sm">
                <span
                  className={cn(
                    "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground",
                    tone,
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{eventTitle(item)}</p>
                  {item.text && item.type !== "status_change" && (
                    <p className="whitespace-pre-line break-words text-muted-foreground">
                      {item.text}
                    </p>
                  )}
                  <p
                    className="text-xs text-muted-foreground"
                    title={format(new Date(item.at), "PPpp")}
                  >
                    {formatDistanceToNow(new Date(item.at), { addSuffix: true })}
                    {item.actor ? ` · ${item.actor}` : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
