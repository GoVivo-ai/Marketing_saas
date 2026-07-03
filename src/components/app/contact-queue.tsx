"use client";

import { useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  PhoneCall,
  MessageSquare,
  MapPin,
  MapPinOff,
  SkipForward,
  History,
  Loader2,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  dialerCall,
  dialerSms,
  isDialerConfigured,
} from "@/components/app/ringcentral-dialer";
import { LeadActivity } from "@/components/app/lead-activity";
import { logLeadOutreach } from "@/lib/actions/leads";
import type { OutreachChannel, OutreachOutcome } from "@/lib/outreach";
import type { ContactQueueData, QueueItem } from "@/lib/data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const NEEDS_DIALER =
  "Open the RingCentral dialer (bottom-right) and sign in first.";

/** One-click outcomes — replaces the two dropdowns of the activity logger. */
const OUTCOME_CHIPS: {
  outcome: OutreachOutcome;
  label: string;
  tone: string;
}[] = [
  { outcome: "answered", label: "Answered", tone: "text-success border-success/40" },
  { outcome: "replied", label: "Replied", tone: "text-success border-success/40" },
  { outcome: "voicemail", label: "Voicemail", tone: "text-amber-600 border-amber-500/40" },
  { outcome: "no_answer", label: "No answer", tone: "text-amber-600 border-amber-500/40" },
  { outcome: "not_interested", label: "Not interested", tone: "text-destructive border-destructive/40" },
  { outcome: "wrong_number", label: "Wrong number", tone: "text-destructive border-destructive/40" },
];

const CHANNEL_LABEL: Record<OutreachChannel, string> = {
  call: "Call",
  sms: "SMS",
  email: "Email",
  whatsapp: "WhatsApp",
};

function geoLine(item: QueueItem): {
  text: string;
  cls: string;
  off: boolean;
} | null {
  const geo = item.geo;
  if (!geo) return null;
  const u = geo.unit === "kilometer" ? "km" : "mi";
  switch (geo.status) {
    case "within":
      return {
        text: `${geo.leadCity ?? "Lead"} — within radius (~${geo.distance} ${u} from ${geo.targetCity})`,
        cls: "text-success",
        off: false,
      };
    case "near":
      return {
        text: `${geo.leadCity ?? "Lead"} — near the edge (~${geo.distance} ${u} from ${geo.targetCity})`,
        cls: "text-amber-600",
        off: false,
      };
    case "outside":
      return {
        text: `${geo.leadCity ?? "Lead"} — outside area (~${geo.distance} ${u} from ${geo.targetCity})`,
        cls: "text-destructive",
        off: false,
      };
    case "no_location":
      return { text: "No location in form", cls: "text-muted-foreground", off: true };
    default:
      return geo.leadCity
        ? { text: geo.leadCity, cls: "text-muted-foreground", off: false }
        : null;
  }
}

function lastTouchLine(item: QueueItem): string {
  if (!item.lastTouchAt) return "Never contacted";
  const ago = formatDistanceToNow(new Date(item.lastTouchAt), { addSuffix: true });
  const channel = item.lastChannel
    ? CHANNEL_LABEL[item.lastChannel as OutreachChannel] ?? item.lastChannel
    : null;
  const outcome = item.lastOutcome
    ? OUTCOME_CHIPS.find((c) => c.outcome === item.lastOutcome)?.label ?? item.lastOutcome
    : "outcome not logged";
  return `${item.touches} ${item.touches === 1 ? "touch" : "touches"} · last ${channel ?? "touch"} ${ago} · ${outcome}`;
}

export function ContactQueue({ data }: { data: ContactQueueData }) {
  const [items, setItems] = useState(data.items);
  const [channel, setChannel] = useState<OutreachChannel>("call");
  const [showHistory, setShowHistory] = useState(false);
  const [logging, startLog] = useTransition();
  const [done, setDone] = useState(0);

  const current = items[0] ?? null;
  const upNext = items.slice(1, 6);

  const advance = () => {
    setItems((list) => list.slice(1));
    setShowHistory(false);
    setChannel("call");
  };

  const onCall = () => {
    if (!current?.phone) return;
    setChannel("call");
    if (!dialerCall(current.phone)) toast.error(NEEDS_DIALER);
  };

  const onSms = () => {
    if (!current?.phone) return;
    setChannel("sms");
    if (!dialerSms(current.phone)) toast.error(NEEDS_DIALER);
  };

  const onOutcome = (outcome: OutreachOutcome) =>
    startLog(async () => {
      if (!current) return;
      const r = await logLeadOutreach(current.id, { channel, outcome });
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      setDone((n) => n + 1);
      toast.success(
        outcome === "answered" || outcome === "replied"
          ? `${current.name} marked as contacted — moved forward.`
          : `Logged: ${CHANNEL_LABEL[channel]} · ${OUTCOME_CHIPS.find((c) => c.outcome === outcome)?.label}.`,
      );
      advance();
    });

  const onSkip = () => {
    // Send the current lead to the back of the queue without logging anything.
    setItems((list) => (list.length > 1 ? [...list.slice(1), list[0]] : list));
    setShowHistory(false);
  };

  if (!current) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
          <CheckCircle2 className="h-8 w-8 text-success" />
          <p className="font-medium">
            {done > 0 ? `Queue clear — ${done} leads worked this session.` : "Queue clear."}
          </p>
          <p className="text-sm text-muted-foreground">
            {data.coolingDown > 0
              ? `${data.coolingDown} contacted ${data.coolingDown === 1 ? "lead is" : "leads are"} waiting inside the follow-up window and will come back automatically.`
              : "New leads and due follow-ups will show up here."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const geo = geoLine(current);

  return (
    <div className="space-y-4">
      {/* Current lead — the working card. */}
      <Card className="border-primary/30">
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">{current.name}</h2>
                <Badge variant={current.due === "follow_up" ? "destructive" : "secondary"}>
                  {current.due === "follow_up" ? "Follow-up due" : "New lead"}
                </Badge>
                {current.aiScore != null && (
                  <Badge variant="outline">Score {current.aiScore}</Badge>
                )}
                {current.stageName && (
                  <Badge
                    variant="outline"
                    style={current.stageColor ? { borderColor: current.stageColor, color: current.stageColor } : undefined}
                  >
                    {current.stageName}
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {current.phone ?? "No phone"}
                {current.email ? ` · ${current.email}` : ""}
                {current.campaign ? ` · ${current.campaign}` : ""}
              </p>
              {geo && (
                <p className={cn("mt-1 flex items-center gap-1.5 text-sm", geo.cls)}>
                  {geo.off ? <MapPinOff className="h-3.5 w-3.5" /> : <MapPin className="h-3.5 w-3.5" />}
                  {geo.text}
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {lastTouchLine(current)} · entered{" "}
                {formatDistanceToNow(new Date(current.createdAt), { addSuffix: true })}
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={onSkip}>
              <SkipForward className="mr-1 h-3.5 w-3.5" />
              Skip
            </Button>
          </div>

          {current.aiSuggestedAction && (
            <p className="flex items-start gap-1.5 rounded-md bg-muted/50 p-2.5 text-sm">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              {current.aiSuggestedAction}
            </p>
          )}

          {/* Reach out … */}
          <div className="flex flex-wrap items-center gap-2">
            {isDialerConfigured ? (
              <>
                <Button size="sm" disabled={!current.phone} onClick={onCall}>
                  <PhoneCall className="mr-1 h-3.5 w-3.5" />
                  Call
                </Button>
                <Button size="sm" variant="outline" disabled={!current.phone} onClick={onSms}>
                  <MessageSquare className="mr-1 h-3.5 w-3.5" />
                  SMS
                </Button>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                The in-app dialer isn&apos;t configured — log the outcome of calls
                made outside the platform below.
              </p>
            )}
            <span className="text-xs text-muted-foreground">
              Logging as: {CHANNEL_LABEL[channel]}
            </span>
          </div>

          {/* … then one click to log what happened and move on. */}
          <div className="flex flex-wrap gap-1.5">
            {OUTCOME_CHIPS.map((c) => (
              <Button
                key={c.outcome}
                size="sm"
                variant="outline"
                disabled={logging}
                className={cn("h-8", c.tone)}
                onClick={() => onOutcome(c.outcome)}
              >
                {logging ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                {c.label}
              </Button>
            ))}
          </div>

          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => setShowHistory((v) => !v)}
          >
            <History className="mr-1 h-3.5 w-3.5" />
            {showHistory ? "Hide history & notes" : "History & notes"}
          </Button>
          {showHistory && (
            <div className="rounded-md border p-3">
              <LeadActivity key={current.id} leadId={current.id} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Up next — enough context to see what's coming, no interaction. */}
      {upNext.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Up next · {items.length - 1} in queue
          </h3>
          <ul className="divide-y rounded-md border">
            {upNext.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <span className="font-medium">{item.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {item.geo?.leadCity ?? ""}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  {item.aiScore != null && <span>Score {item.aiScore}</span>}
                  <Badge variant={item.due === "follow_up" ? "destructive" : "secondary"}>
                    {item.due === "follow_up" ? "Follow-up" : "New"}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
