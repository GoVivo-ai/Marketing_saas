"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addHours, format, formatDistanceToNowStrict } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Clock,
  Loader2,
  MessageSquare,
  Phone,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { prettyNumber, useDialNumber } from "@/components/app/softphone";
import {
  claimLead,
  logLeadOutreach,
  releaseLead,
  scheduleLeadCallback,
  setLeadDisqual,
} from "@/lib/actions/leads";
import { DISQUAL_PREFILL, OUTCOME_CHIPS, type OutreachOutcome } from "@/lib/outreach";
import type { ContactQueueData, QueueItem } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** What a call can end in — the SMS/email-only outcomes don't belong here. */
const CALL_OUTCOMES: OutreachOutcome[] = [
  "answered",
  "no_answer",
  "voicemail",
  "not_interested",
  "wrong_number",
];
const CHIPS = OUTCOME_CHIPS.filter((c) => CALL_OUTCOMES.includes(c.outcome));

/** `<input type="datetime-local">` wants local time without a zone. */
function toLocalInput(d: Date): string {
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

function dueLabel(item: QueueItem): string {
  if (item.callBackAt) return `Callback ${format(item.callBackAt, "MMM d, h:mm a")}`;
  return item.due === "new" ? "New" : "Follow-up";
}

/**
 * The contact queue for a handset: who to call next, one tap to call, one tap
 * to log what happened. Same queue and same server actions as the desktop
 * Contact Queue; the long-form flows (RCA picker, profile steps, undo) stay
 * on the desktop.
 */
export function MobileQueue({
  data,
  onText,
}: {
  data: ContactQueueData;
  onText: (number: string) => void;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  // Leads logged in this session leave the list at once; the server drops
  // them too on the next refresh.
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const items = useMemo(() => data.items.filter((i) => !handled.has(i.id)), [data.items, handled]);
  const open = items.find((i) => i.id === openId) ?? null;

  if (open) {
    return (
      <LeadCard
        key={open.id}
        item={open}
        onBack={() => setOpenId(null)}
        onText={onText}
        onDone={() => {
          setHandled((s) => new Set(s).add(open.id));
          setOpenId(null);
        }}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">
            {Math.max(0, data.total - handled.size)}
          </span>{" "}
          to call
          {data.total > data.items.length ? ` · next ${items.length} shown` : ""}
        </p>
        <button
          type="button"
          onClick={() => startRefresh(() => router.refresh())}
          aria-label="Refresh queue"
          className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
        >
          <RefreshCw className={cn("h-5 w-5", refreshing && "animate-spin")} />
        </button>
      </div>

      {items.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-muted-foreground">
          Nothing to call right now. Pull the latest with the refresh button.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y overflow-y-auto border-t">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setOpenId(item.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-muted"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-base font-medium">
                    {item.priorityMatch && <Sparkles className="h-4 w-4 shrink-0 text-amber-500" />}
                    <span className="truncate">{item.name}</span>
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    <span
                      className={cn(
                        "font-medium",
                        item.callBackAt ? "text-amber-600" : item.due === "new" ? "text-success" : "text-foreground",
                      )}
                    >
                      {dueLabel(item)}
                    </span>
                    {item.campaign ? ` · ${item.campaign}` : ""}
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LeadCard({
  item,
  onBack,
  onText,
  onDone,
}: {
  item: QueueItem;
  onBack: () => void;
  onText: (number: string) => void;
  onDone: () => void;
}) {
  const dial = useDialNumber();
  const [saving, startSave] = useTransition();
  const [note, setNote] = useState("");
  // A terminal outcome asks once before it takes the lead out for good.
  const [confirming, setConfirming] = useState<OutreachOutcome | null>(null);
  const [callbackAt, setCallbackAt] = useState(() => toLocalInput(addHours(new Date(), 2)));
  const [claimedBy, setClaimedBy] = useState<string | null>(null);

  // Hold the lead while it is open so two agents don't call it at once. The
  // claim expires by itself server-side; releasing just frees it sooner.
  useEffect(() => {
    let active = true;
    claimLead(item.id)
      .then((r) => active && setClaimedBy(r.ok ? null : r.by))
      .catch(() => {});
    return () => {
      active = false;
      releaseLead(item.id).catch(() => {});
    };
  }, [item.id]);

  const log = (outcome: OutreachOutcome) =>
    startSave(async () => {
      const r = await logLeadOutreach(item.id, {
        channel: "call",
        outcome,
        note: note.trim() || undefined,
      });
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      const reason = DISQUAL_PREFILL[outcome];
      if (reason) {
        const d = await setLeadDisqual(item.id, reason);
        if (!d.ok) {
          toast.error(`Call logged, but the lead was not disqualified: ${d.message}`);
          return;
        }
      }
      toast.success(`${item.name}: ${OUTCOME_CHIPS.find((c) => c.outcome === outcome)?.label}.`);
      onDone();
    });

  const schedule = () =>
    startSave(async () => {
      const at = new Date(callbackAt);
      const r = await scheduleLeadCallback(item.id, {
        at: at.toISOString(),
        note: note.trim() || undefined,
      });
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      toast.success(`Callback set for ${format(at, "EEE MMM d, h:mm a")}.`);
      onDone();
    });

  const place = [item.geo?.leadCity, item.geo?.leadRegion].filter(Boolean).join(", ");
  const pendingReason = confirming ? DISQUAL_PREFILL[confirming] : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to queue"
          className="flex h-11 w-11 items-center justify-center rounded-full active:bg-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <span className="text-sm text-muted-foreground">Queue</span>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <div>
          <h1 className="text-xl font-semibold leading-tight">{item.name}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {[dueLabel(item), item.campaign, place].filter(Boolean).join(" · ")}
          </p>
        </div>

        {claimedBy && (
          <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {claimedBy} is working this lead right now.
          </p>
        )}

        {item.phone ? (
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Button
              className="h-14 bg-success text-base text-white hover:bg-success/90"
              onClick={() => dial(item.phone)}
            >
              <Phone className="mr-2 h-5 w-5" />
              Call {prettyNumber(item.phone)}
            </Button>
            <Button
              variant="outline"
              className="h-14 w-14"
              aria-label="Text this lead"
              onClick={() => onText(item.phone!)}
            >
              <MessageSquare className="h-5 w-5" />
            </Button>
          </div>
        ) : (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            This lead has no phone number.
          </p>
        )}

        {(item.touches > 0 || item.aiSuggestedAction) && (
          <div className="space-y-2 text-sm">
            {item.touches > 0 && item.lastTouchAt && (
              <p className="flex items-start gap-2 text-muted-foreground">
                <Clock className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {item.touches} {item.touches === 1 ? "touch" : "touches"} · last{" "}
                  {formatDistanceToNowStrict(item.lastTouchAt, { addSuffix: true })}
                  {item.lastOutcome ? ` · ${item.lastOutcome.replace(/_/g, " ")}` : ""}
                  {item.lastBy ? ` · ${item.lastBy}` : ""}
                </span>
              </p>
            )}
            {item.aiSuggestedAction && (
              <p className="flex items-start gap-2">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <span>{item.aiSuggestedAction}</span>
              </p>
            )}
          </div>
        )}

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">How did the call go?</h2>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            rows={2}
            placeholder="Note (optional)"
            className="w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-base outline-none focus-visible:border-ring"
          />
          {pendingReason && confirming ? (
            <div className="space-y-2 rounded-lg border border-destructive/40 p-3">
              <p className="text-sm">
                This takes {item.name} out of the queue as{" "}
                <span className="font-medium">{pendingReason.l3}</span>.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="h-12" disabled={saving} onClick={() => setConfirming(null)}>
                  Cancel
                </Button>
                <Button variant="destructive" className="h-12" disabled={saving} onClick={() => log(confirming)}>
                  {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  Confirm
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {CHIPS.map((c) => (
                <Button
                  key={c.outcome}
                  variant="outline"
                  className="h-12 justify-start text-sm"
                  disabled={saving}
                  onClick={() => (c.outcome in DISQUAL_PREFILL ? setConfirming(c.outcome) : log(c.outcome))}
                >
                  <span className={cn("mr-2 h-2.5 w-2.5 shrink-0 rounded-full", c.dot)} />
                  {c.label}
                </Button>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2 pb-4">
          <h2 className="text-sm font-semibold">Asked to be called back?</h2>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input
              type="datetime-local"
              value={callbackAt}
              min={toLocalInput(new Date())}
              onChange={(e) => setCallbackAt(e.target.value)}
              aria-label="Callback date and time"
              className="h-12 min-w-0 rounded-lg border border-input bg-transparent px-3 text-base outline-none focus-visible:border-ring"
            />
            <Button variant="outline" className="h-12" disabled={saving || !callbackAt} onClick={schedule}>
              Schedule
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
