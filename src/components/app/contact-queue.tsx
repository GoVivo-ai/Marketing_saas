"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  PhoneCall,
  MessageSquare,
  Mail,
  MapPin,
  MapPinOff,
  CarFront,
  AlertTriangle,
  Clock,
  Undo2,
  SkipForward,
  History,
  Loader2,
  CheckCircle2,
  Sparkles,
  Ban,
  ListChecks,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import {
  dialerCall,
  dialerSms,
  isDialerConfigured,
} from "@/components/app/ringcentral-dialer";
import { LeadActivity } from "@/components/app/lead-activity";
import { LeadDetailSheet } from "@/components/app/lead-detail-sheet";
import {
  addLeadNote,
  getLeadDetail,
  claimLead,
  logLeadOutreach,
  markLeadCcActivated,
  releaseLead,
  setLeadDisqual,
  undoLeadOutreach,
} from "@/lib/actions/leads";
import { RCA_LEVEL1, rcaLevel2, rcaLevel3, isValidRcaPath } from "@/lib/rca";
import { DISQUAL_PREFILL, OUTCOME_CHIPS } from "@/lib/outreach";
import type { OutreachChannel, OutreachOutcome } from "@/lib/outreach";
import type { ContactQueueData, LeadRow, QueueItem } from "@/lib/data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const NEEDS_DIALER =
  "Open the RingCentral dialer (bottom-right) and sign in first.";

/**
 * The in-progress session is mirrored to localStorage so accidentally leaving
 * the page (a mis-click on the sidebar, a reload) doesn't wipe the agent's
 * progress: queue position, the worked-this-session list (undo), and a
 * half-finished RCA / follow-up sub-flow all come back on return.
 */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

interface StoredSession {
  at: number;
  done: number;
  worked: { item: QueueItem; outcome: OutreachOutcome; eventId: string | null }[];
  /** Queue order (lead ids) at save time — restores skips and jumps. */
  order: string[];
  /** Leads already logged this session, filtered out of fresh server data. */
  handled: string[];
  channel: OutreachChannel;
  /** A sub-flow (RCA / follow-up) left open on the current lead. */
  pending: {
    item: QueueItem;
    disqualOutcome: OutreachOutcome | null;
    followUp: boolean;
    eventId: string | null;
  } | null;
}

function sessionKey(workspaceId: string | null) {
  return `contact-queue-session:${workspaceId ?? "default"}`;
}

function readSession(key: string): StoredSession | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const s = JSON.parse(raw) as StoredSession;
    if (typeof s?.at !== "number" || Date.now() - s.at > SESSION_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

const CHANNEL_LABEL: Record<OutreachChannel, string> = {
  call: "Call",
  sms: "SMS",
  email: "Email",
  whatsapp: "WhatsApp",
};

/**
 * Follow-up dispositions offered after a connected call, straight from the RCA
 * "Process / Follow-up" branches. A connected lead isn't lost, so these are
 * recorded as notes (not a disqualification) and the lead stays in the
 * follow-up window. The two "Profile created" steps let the agent mark where a
 * lead sits in profile creation (next steps explained → completing A1s) without
 * the RCA/disqualify path wrongly moving it to Lost.
 */
const FOLLOWUP_REASONS = [
  "Requested info by email / SMS",
  "Requested a callback",
  "Email Sent / SMS Sent",
] as const;

/**
 * The "Profile created" progression — grouped in one dropdown so the agent
 * marks where the lead sits in profile creation (next steps explained →
 * completing A1s) without cluttering the quick dispositions above.
 */
const PROFILE_STEPS = [
  "Profile created - Next Steps Explained",
  "Profile created - Completing A1s",
] as const;

/**
 * Shown after a connected call ("answered") so the agent can record what the
 * lead asked for — e.g. the offer info by email/SMS — instead of the card
 * closing with no options. The touch was already logged (and auto-advanced the
 * lead); this just attaches the follow-up reason as a note so it comes back.
 */
function AnswerFollowUp({
  leadId,
  onDone,
}: {
  leadId: string;
  onDone: () => void;
}) {
  const [saving, startSave] = useTransition();
  const [pending, setPending] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const pick = (reason: string) =>
    startSave(async () => {
      setPending(reason);
      // Any note the agent typed is appended to the disposition so it comes
      // through in the lead's history alongside the reason.
      const trimmed = note.trim();
      const body = trimmed ? `Follow-up: ${reason} — ${trimmed}` : `Follow-up: ${reason}`;
      const r = await addLeadNote(leadId, body);
      if (!r.ok) {
        toast.error(r.message);
        setPending(null);
        return;
      }
      toast.success(`Follow-up noted: ${reason}.`);
      onDone();
    });

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <CheckCircle2 className="h-4 w-4 text-success" />
          Connected — any follow-up?
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Mark where the lead stands so it comes back for follow-up. Otherwise
          just move on.
        </p>
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        disabled={saving}
        placeholder="Optional note — add details before picking a disposition below."
        className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
      />
      <div className="flex flex-wrap items-center gap-2">
        {FOLLOWUP_REASONS.map((reason) => (
          <Button
            key={reason}
            size="sm"
            variant="outline"
            disabled={saving}
            className="h-8 gap-1.5 font-normal"
            onClick={() => pick(reason)}
          >
            {saving && pending === reason ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
            )}
            {reason}
          </Button>
        ))}
        {/* Profile-created progression grouped in its own dropdown. */}
        <Select value="" onValueChange={(v) => v && pick(v)} disabled={saving}>
          <SelectTrigger
            className="h-8 w-auto gap-1.5 text-sm font-normal"
            aria-label="Profile created"
          >
            <SelectValue placeholder="Profile created…" />
          </SelectTrigger>
          <SelectContent>
            {PROFILE_STEPS.map((step) => (
              <SelectItem key={step} value={step}>
                {step.replace("Profile created - ", "")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="ghost"
          className="h-8"
          disabled={saving}
          onClick={onDone}
        >
          No follow-up — next
        </Button>
      </div>
    </div>
  );
}

/** Compact RCA capture shown in the queue card after a terminal outcome. */
function QueueDisqualify({
  leadId,
  prefill,
  onDone,
}: {
  leadId: string;
  prefill: { l1: string; l2: string; l3: string } | undefined;
  onDone: () => void;
}) {
  const [l1, setL1] = useState(prefill?.l1 ?? "");
  const [l2, setL2] = useState(prefill?.l2 ?? "");
  const [l3, setL3] = useState(prefill?.l3 ?? "");
  const [note, setNote] = useState("");
  const [saving, startSave] = useTransition();
  const valid = isValidRcaPath(l1, l2, l3);

  const onSave = () =>
    startSave(async () => {
      const r = await setLeadDisqual(leadId, { l1, l2, l3, note });
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      toast.success("Disqualification reason saved.");
      onDone();
    });

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Ban className="h-4 w-4 text-destructive" />
          Why was this lead lost?
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Pre-filled with the usual reason — adjust if it doesn&apos;t fit.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Select
          value={l1}
          onValueChange={(v) => {
            if (!v) return;
            setL1(v);
            setL2("");
            setL3("");
          }}
        >
          <SelectTrigger className="h-8 text-xs" aria-label="Driver">
            <SelectValue placeholder="Driver…" />
          </SelectTrigger>
          <SelectContent>
            {RCA_LEVEL1.map((v) => (
              <SelectItem key={v} value={v}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={l2}
          onValueChange={(v) => {
            if (!v) return;
            setL2(v);
            setL3("");
          }}
          disabled={!l1}
        >
          <SelectTrigger className="h-8 text-xs" aria-label="Category">
            <SelectValue placeholder="Category…" />
          </SelectTrigger>
          <SelectContent>
            {rcaLevel2(l1).map((v) => (
              <SelectItem key={v} value={v}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={l3} onValueChange={(v) => v && setL3(v)} disabled={!l2}>
          <SelectTrigger className="h-8 text-xs" aria-label="Reason">
            <SelectValue placeholder="Reason…" />
          </SelectTrigger>
          <SelectContent>
            {rcaLevel3(l1, l2).map((v) => (
              <SelectItem key={v} value={v}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional detail…"
        maxLength={2000}
        className="h-8 text-xs"
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" className="h-8" onClick={onDone}>
          Decide later
        </Button>
        <Button size="sm" className="h-8" disabled={!valid || saving} onClick={onSave}>
          {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          Save & next
        </Button>
      </div>
    </div>
  );
}

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
        cls: "text-amber-500",
        off: false,
      };
    case "outside":
      return {
        text: `${geo.leadCity ?? "Lead"} — outside area (~${geo.distance} ${u} from ${geo.targetCity})`,
        cls: "text-destructive",
        off: false,
      };
    case "no_location":
      return {
        text: geo.targetCity
          ? `No location in form — applying to ${geo.targetCity}`
          : "No location in form",
        cls: "text-muted-foreground",
        off: true,
      };
    default:
      // No ad-set radius to judge against — still show where the driver is
      // and which area they applied to.
      if (geo.leadCity && geo.targetCity)
        return {
          text: `${geo.leadCity} — applying to ${geo.targetCity}`,
          cls: "text-muted-foreground",
          off: false,
        };
      if (geo.leadCity)
        return { text: geo.leadCity, cls: "text-muted-foreground", off: false };
      if (geo.targetCity)
        return {
          text: `Applying to ${geo.targetCity}`,
          cls: "text-muted-foreground",
          off: false,
        };
      return null;
  }
}

/** Vehicle-year verdict for the "Vehicle" cell, mirroring geoLine's shape. */
function vehicleLine(item: QueueItem): {
  text: string;
  cls: string;
  off: boolean;
} {
  const v = item.vehicle;
  switch (v.status) {
    case "eligible":
      return {
        text: `Yes — vehicle ${v.minYear} or newer`,
        cls: "text-success",
        off: false,
      };
    case "too_old":
      return {
        text: `No — vehicle older than ${v.minYear}`,
        cls: "text-destructive",
        off: true,
      };
    default:
      return {
        text: `Not asked — confirm ${v.minYear}+`,
        cls: "text-muted-foreground",
        off: true,
      };
  }
}

/** Schedule-availability verdict for the "Schedule" cell, mirroring vehicleLine. */
function scheduleLine(item: QueueItem): {
  text: string;
  cls: string;
  off: boolean;
} {
  const s = item.schedule;
  switch (s.status) {
    case "full":
      return {
        text: "Yes — available for required blocks",
        cls: "text-success",
        off: false,
      };
    case "partial":
      return {
        text: `Partial — ${s.block ?? "some blocks"} only`,
        cls: "text-amber-500",
        off: true,
      };
    case "none":
      return {
        text: "No — can't work required blocks",
        cls: "text-destructive",
        off: true,
      };
    default:
      return {
        text: "Not asked — confirm availability",
        cls: "text-muted-foreground",
        off: true,
      };
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
  const by = item.lastBy ? ` by ${item.lastBy}` : "";
  return `${item.touches} ${item.touches === 1 ? "touch" : "touches"} · last ${channel ?? "touch"}${by} ${ago} · ${outcome}`;
}

/** Subtle status pill, matching the table's "● New" stage badges. */
function DueBadge({ due }: { due: QueueItem["due"] }) {
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          due === "follow_up" ? "bg-amber-500" : "bg-success",
        )}
      />
      {due === "follow_up" ? "Follow-up due" : "New lead"}
    </Badge>
  );
}

/** The workspace's score-automation rule, when it flags leads in the queue. */
export interface QueueAutomation {
  direction: "above" | "below";
  threshold: number;
  message: string;
}

function automationScript(
  automation: QueueAutomation | null | undefined,
  lead: QueueItem,
): string | null {
  if (!automation || lead.aiScore == null) return null;
  const matches =
    automation.direction === "below"
      ? lead.aiScore <= automation.threshold
      : lead.aiScore >= automation.threshold;
  if (!matches) return null;
  const firstName = lead.name?.trim().split(/\s+/)[0] ?? "";
  return automation.message
    .replaceAll("{name}", firstName || "there")
    .replaceAll("{campaign}", lead.campaign ?? "");
}

export function ContactQueue({
  data,
  automation,
  defaultCriteria,
  workspaceId,
}: {
  data: ContactQueueData;
  automation?: QueueAutomation | null;
  /** Workspace-wide criteria, shown when the lead's campaign has none. */
  defaultCriteria?: string | null;
  /** Scopes the persisted session so workspaces don't cross-restore. */
  workspaceId?: string | null;
}) {
  const [items, setItems] = useState(data.items);
  const [channel, setChannel] = useState<OutreachChannel>("call");
  const [showHistory, setShowHistory] = useState(false);
  const [logging, startLog] = useTransition();
  const [done, setDone] = useState(0);
  /** Set after a terminal outcome — the card asks for the RCA before moving on. */
  const [disqualOutcome, setDisqualOutcome] = useState<OutreachOutcome | null>(null);
  /** Set after a connected call — the card offers a follow-up disposition. */
  const [followUp, setFollowUp] = useState(false);
  /**
   * The touch that opened the current sub-flow (RCA / follow-up), so its
   * "Back — wrong option" button can undo it and return to the outcome chips.
   */
  const [lastEvent, setLastEvent] = useState<{
    item: QueueItem;
    eventId: string | null;
  } | null>(null);
  /** Leads worked this session (newest first) — the way back after a mis-click. */
  const [worked, setWorked] = useState<
    { item: QueueItem; outcome: OutreachOutcome; eventId: string | null }[]
  >([]);

  // Restore a persisted session on mount, then mirror every change back so
  // leaving the page loses nothing. localStorage can't be read in the state
  // initializers (the SSR pass has no storage, so hydration would mismatch),
  // hence the one-shot setState-in-effect.
  const storageKey = sessionKey(workspaceId ?? null);
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const s = readSession(storageKey);
    if (!s) return;
    const handled = new Set(s.handled);
    const pendingId = s.pending?.item.id ?? null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems((list) => {
      const pos = new Map(s.order.map((id, i) => [id, i]));
      // Drop leads already logged this session; keep the saved working order,
      // with leads new since then appended at the end.
      const next = list
        .filter((x) => !handled.has(x.id) || x.id === pendingId)
        .sort(
          (a, b) =>
            (pos.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
            (pos.get(b.id) ?? Number.MAX_SAFE_INTEGER),
        );
      if (!s.pending) return next;
      // A sub-flow was open — its lead goes back to the front even if the
      // fresh server data no longer includes it.
      const i = next.findIndex((x) => x.id === pendingId);
      const item = i >= 0 ? next.splice(i, 1)[0] : s.pending.item;
      return [item, ...next];
    });
    setDone(s.done);
    setWorked(s.worked);
    setChannel(s.channel);
    if (s.pending) {
      setDisqualOutcome(s.pending.disqualOutcome);
      setFollowUp(s.pending.followUp);
      setLastEvent({ item: s.pending.item, eventId: s.pending.eventId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!restored.current) return;
    const pendingItem =
      lastEvent && (disqualOutcome || followUp) ? lastEvent.item : null;
    const session: StoredSession = {
      at: Date.now(),
      done,
      worked,
      order: items.map((x) => x.id),
      handled: worked.map((w) => w.item.id),
      channel,
      pending: pendingItem
        ? {
            item: pendingItem,
            disqualOutcome,
            followUp,
            eventId: lastEvent?.eventId ?? null,
          }
        : null,
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(session));
    } catch {
      // Storage full / unavailable — the queue still works, just unpersisted.
    }
  }, [items, done, worked, channel, disqualOutcome, followUp, lastEvent, storageKey]);

  const current = items[0] ?? null;
  const upNext = items.slice(1, 7);

  // Soft-claim the lead on deck so two agents don't call it at once. If
  // someone beat us to it (their queue already had it up), show who — the
  // agent can Skip. The claim self-expires server-side (no unlock to forget).
  // Keyed by lead id so a stale warning never shows on the next lead.
  const [claim, setClaim] = useState<{ id: string; by: string } | null>(null);
  const currentId = current?.id ?? null;
  useEffect(() => {
    let active = true;
    if (!currentId) return;
    claimLead(currentId)
      .then((r) => {
        if (active) setClaim(r.ok ? null : { id: currentId, by: r.by });
      })
      .catch(() => {
        // Claiming is best-effort — the queue keeps working without it.
      });
    return () => {
      active = false;
    };
  }, [currentId]);
  const claimedBy = claim && claim.id === currentId ? claim.by : null;

  const advance = () => {
    // Logged and moving on — free the claim right away (it would otherwise
    // linger for the TTL; the follow-up window already keeps the lead out).
    if (current) releaseLead(current.id).catch(() => {});
    setItems((list) => list.slice(1));
    setShowHistory(false);
    setChannel("call");
    setDisqualOutcome(null);
    setFollowUp(false);
    setLastEvent(null);
  };

  /** Jump the queue: bring an Up-next lead to the front to work it now. */
  const workNow = (id: string) => {
    setItems((list) => {
      const i = list.findIndex((x) => x.id === id);
      if (i <= 0) return list;
      return [list[i], ...list.slice(0, i), ...list.slice(i + 1)];
    });
    setShowHistory(false);
    setChannel("call");
    setDisqualOutcome(null);
    setFollowUp(false);
    setLastEvent(null);
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

  // Opens the default mail client (e.g. Outlook) with the lead's address —
  // the email counterpart of the post-call SMS option. No dialer needed.
  const onEmail = () => {
    if (!current?.email) return;
    setChannel("email");
    window.location.href = `mailto:${current.email}`;
  };

  /** Deletes the mis-logged touch and puts the lead back at the front. */
  const undo = (item: QueueItem, eventId: string | null) =>
    startLog(async () => {
      try {
        const r = await undoLeadOutreach(item.id, eventId);
        if (!r.ok) {
          toast.error(r.message);
          return;
        }
        setWorked((list) =>
          list.filter((w) => (eventId ? w.eventId !== eventId : w.item.id !== item.id)),
        );
        setDone((n) => Math.max(0, n - 1));
        setItems((list) =>
          list[0]?.id === item.id ? list : [item, ...list.filter((i) => i.id !== item.id)],
        );
        setDisqualOutcome(null);
        setFollowUp(false);
        setLastEvent(null);
        toast.success(`Undone — ${item.name} is back at the front of the queue.`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't undo. Try again.");
      }
    });

  const onOutcome = (outcome: OutreachOutcome) =>
    startLog(async () => {
      if (!current) return;
      const r = await logLeadOutreach(current.id, { channel, outcome });
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      const eventId = r.eventId ?? null;
      const item = current;
      setDone((n) => n + 1);
      setWorked((list) => [{ item, outcome, eventId }, ...list].slice(0, 20));
      const undoAction = eventId
        ? { action: { label: "Undo", onClick: () => undo(item, eventId) } }
        : undefined;
      // Terminal outcomes stay on the card to capture the RCA reason (the
      // spreadsheet's RCA Lvl 1/2/3) before moving to the next lead.
      if (outcome in DISQUAL_PREFILL) {
        toast.success(
          `Logged: ${CHANNEL_LABEL[channel]} · ${OUTCOME_CHIPS.find((c) => c.outcome === outcome)?.label}.`,
          undoAction,
        );
        setLastEvent({ item, eventId });
        setDisqualOutcome(outcome);
        return;
      }
      // A connected call stays on the card so the agent can record a follow-up
      // disposition (e.g. "Requested info by email / SMS") before moving on.
      if (outcome === "answered") {
        toast.success(
          `${item.name} connected — add a follow-up if info was requested.`,
          undoAction,
        );
        setLastEvent({ item, eventId });
        setFollowUp(true);
        return;
      }
      toast.success(
        outcome === "replied"
          ? `${item.name} marked as contacted — moved forward.`
          : `Logged: ${CHANNEL_LABEL[channel]} · ${OUTCOME_CHIPS.find((c) => c.outcome === outcome)?.label}.`,
        undoAction,
      );
      advance();
    });

  /** The lead's CC profile got activated — move stages and leave the queue. */
  const onCcActivated = () =>
    startLog(async () => {
      if (!current) return;
      const item = current;
      const r = await markLeadCcActivated(item.id);
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      setDone((n) => n + 1);
      toast.success(`${item.name} moved to ${r.stageName} — out of the queue.`);
      advance();
    });

  const onSkip = () => {
    // Send the current lead to the back of the queue without logging anything.
    if (current) releaseLead(current.id).catch(() => {});
    setItems((list) => (list.length > 1 ? [...list.slice(1), list[0]] : list));
    setShowHistory(false);
  };

  // Full lead detail opens in a side panel — the agent stays in the queue.
  const [detail, setDetail] = useState<LeadRow | null>(null);
  const [detailLoading, startDetail] = useTransition();
  const openDetail = (leadId: string) =>
    startDetail(async () => {
      const row = await getLeadDetail(leadId);
      if (row) setDetail(row);
      else toast.error("Couldn't load the lead's details.");
    });

  const geo = current ? geoLine(current) : null;
  const veh = current ? vehicleLine(current) : null;
  const sched = current ? scheduleLine(current) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* ── Current lead — the working card ─────────────────────────── */}
      <Card className="lg:col-span-2 self-start">
        {current ? (
          <>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => openDetail(current.id)}
                      className="inline-flex items-center gap-1.5 hover:text-primary hover:underline"
                      title="Open lead details"
                    >
                      {current.name}
                      {detailLoading && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      )}
                    </button>
                    <DueBadge due={current.due} />
                  </CardTitle>
                  <CardDescription className="mt-1.5">
                    {current.phone ?? "No phone"}
                    {current.email ? ` · ${current.email}` : ""}
                    {current.campaign ? ` · ${current.campaign}` : ""}
                  </CardDescription>
                </div>
                {!disqualOutcome && !followUp && (
                  <Button size="sm" variant="ghost" onClick={onSkip}>
                    <SkipForward className="mr-1 h-3.5 w-3.5" />
                    Skip
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {claimedBy && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                  <span>
                    <span className="font-medium">{claimedBy}</span> is working
                    this lead right now — skip it to avoid a double contact.
                  </span>
                </div>
              )}
              {/* Context the agent checks before dialing. */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">AI Score</p>
                  <p className="mt-0.5 text-sm font-medium">
                    {current.aiScore != null ? current.aiScore : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Location / Area</p>
                  {geo ? (
                    <p className={cn("mt-0.5 flex items-center gap-1.5 text-sm font-medium", geo.cls)}>
                      {geo.off ? (
                        <MapPinOff className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span className="min-w-0">{geo.text}</span>
                    </p>
                  ) : (
                    <p className="mt-0.5 text-sm font-medium">—</p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Vehicle</p>
                  {veh ? (
                    <p className={cn("mt-0.5 flex items-center gap-1.5 text-sm font-medium", veh.cls)}>
                      {veh.off ? (
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <CarFront className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span className="min-w-0">{veh.text}</span>
                    </p>
                  ) : (
                    <p className="mt-0.5 text-sm font-medium">—</p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Schedule</p>
                  {sched ? (
                    <p className={cn("mt-0.5 flex items-center gap-1.5 text-sm font-medium", sched.cls)}>
                      {sched.off ? (
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <Clock className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span className="min-w-0">{sched.text}</span>
                    </p>
                  ) : (
                    <p className="mt-0.5 text-sm font-medium">—</p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Outreach</p>
                  <p className="mt-0.5 text-sm font-medium">{lastTouchLine(current)}</p>
                </div>
              </div>

              {current.aiSuggestedAction && (
                <div className="rounded-lg border p-3">
                  <p className="flex items-start gap-2 text-sm">
                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span className="leading-snug">{current.aiSuggestedAction}</span>
                  </p>
                </div>
              )}

              {(() => {
                const script = automationScript(automation, current);
                if (!script) return null;
                return (
                  <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-primary">
                      Score automation — script for this lead
                    </p>
                    <p className="mt-1 text-sm leading-snug whitespace-pre-wrap">
                      {script}
                    </p>
                  </div>
                );
              })()}

              {disqualOutcome || followUp ? (
                <div className="space-y-2">
                  {/* Wrong option? Undo the touch and return to the chips. */}
                  {lastEvent && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-muted-foreground"
                      disabled={logging}
                      onClick={() => undo(lastEvent.item, lastEvent.eventId)}
                    >
                      <Undo2 className="mr-1 h-3.5 w-3.5" />
                      Back — wrong option
                    </Button>
                  )}
                  {disqualOutcome ? (
                    /* Terminal outcome logged — capture the RCA reason, then move on. */
                    <QueueDisqualify
                      key={current.id}
                      leadId={current.id}
                      prefill={DISQUAL_PREFILL[disqualOutcome]}
                      onDone={advance}
                    />
                  ) : (
                    /* Connected — offer a follow-up disposition before moving on. */
                    <AnswerFollowUp key={current.id} leadId={current.id} onDone={advance} />
                  )}
                </div>
              ) : (
                <>
                  {/* Reach out … */}
                  <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                    {isDialerConfigured ? (
                      <>
                        <Button size="sm" disabled={!current.phone} onClick={onCall}>
                          <PhoneCall className="mr-1.5 h-3.5 w-3.5" />
                          Call
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!current.phone}
                          onClick={onSms}
                        >
                          <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                          SMS
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!current.email}
                          onClick={onEmail}
                        >
                          <Mail className="mr-1.5 h-3.5 w-3.5" />
                          Email
                        </Button>
                        <span className="ml-1 text-xs text-muted-foreground">
                          Logging as {CHANNEL_LABEL[channel]}
                        </span>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!current.email}
                          onClick={onEmail}
                        >
                          <Mail className="mr-1.5 h-3.5 w-3.5" />
                          Email
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          The in-app dialer isn&apos;t configured — log the outcome of
                          calls made outside the platform below.
                        </p>
                      </>
                    )}
                  </div>

                  {/* … then one click to log what happened and move on. */}
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      What happened?
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {OUTCOME_CHIPS.map((c) => (
                        <Button
                          key={c.outcome}
                          size="sm"
                          variant="outline"
                          disabled={logging}
                          className="h-8 gap-1.5 font-normal"
                          onClick={() => onOutcome(c.outcome)}
                        >
                          {logging ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <span className={cn("h-1.5 w-1.5 rounded-full", c.dot)} />
                          )}
                          {c.label}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {/* The lead got activated in Contractor Compliance — record
                      it here (not on the Kanban) and let it leave the queue. */}
                  <div className="border-t pt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={logging}
                      className="h-8 gap-1.5 border-success/40 font-normal text-success hover:text-success"
                      onClick={onCcActivated}
                    >
                      {logging ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ShieldCheck className="h-3.5 w-3.5" />
                      )}
                      Activated in Contractor Compliance
                    </Button>
                  </div>
                </>
              )}

              <div className="border-t pt-3">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  onClick={() => setShowHistory((v) => !v)}
                >
                  <History className="mr-1 h-3.5 w-3.5" />
                  {showHistory ? "Hide history & notes" : "History & notes"}
                </Button>
                {showHistory && (
                  <div className="mt-3">
                    <LeadActivity key={current.id} leadId={current.id} />
                  </div>
                )}
              </div>
            </CardContent>
          </>
        ) : (
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <CheckCircle2 className="h-8 w-8 text-success" />
            <p className="font-medium">
              {done > 0
                ? `Queue clear — ${done} ${done === 1 ? "lead" : "leads"} worked this session.`
                : "Queue clear."}
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {data.coolingDown > 0
                ? `${data.coolingDown} contacted ${data.coolingDown === 1 ? "lead is" : "leads are"} waiting inside the follow-up window and will come back automatically.`
                : "New leads and due follow-ups will show up here."}
            </p>
          </CardContent>
        )}
      </Card>

      {/* ── Side rail: what's coming + what was done ─────────────────── */}
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Up next</CardTitle>
            <CardDescription>
              {Math.max(0, items.length - 1)} more in the queue
            </CardDescription>
          </CardHeader>
          <CardContent>
            {upNext.length ? (
              <ul className="divide-y">
                {upNext.map((item) => (
                  <li key={item.id}>
                    {/* Click to jump the queue and work this lead now. */}
                    <button
                      type="button"
                      onClick={() => workNow(item.id)}
                      title="Work this lead now"
                      className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-2.5 text-left text-sm hover:bg-muted/60"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{item.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {item.geo?.leadCity ?? "—"}
                          {item.geo?.targetCity ? ` → ${item.geo.targetCity}` : ""}
                          {item.aiScore != null ? ` · Score ${item.aiScore}` : ""}
                        </p>
                      </div>
                      <DueBadge due={item.due} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-2 text-sm text-muted-foreground">
                Nothing else queued.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="h-4 w-4 text-primary" />
              Worked this session
            </CardTitle>
            <CardDescription>
              Mis-clicked? Undo removes the touch and brings the lead back.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {worked.length ? (
              <ul className="divide-y">
                {worked.map((w) => (
                  <li
                    key={`${w.item.id}-${w.eventId}`}
                    className="flex items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{w.item.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {OUTCOME_CHIPS.find((c) => c.outcome === w.outcome)?.label}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 shrink-0 px-2 text-xs"
                      disabled={logging}
                      onClick={() => undo(w.item, w.eventId)}
                    >
                      Undo
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-2 text-sm text-muted-foreground">
                Logged outcomes will appear here.
              </p>
            )}
          </CardContent>
        </Card>

        {/* What "a good lead" means for the CURRENT lead — its campaign's
            scoring criteria (AI digest), or the workspace-wide fallback. */}
        {current && (current.criteria ?? defaultCriteria) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-primary" />
                Evaluation criteria
              </CardTitle>
              <CardDescription>
                For {current.name}
                {current.criteria == null ? " · workspace default" : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-snug whitespace-pre-wrap text-muted-foreground">
                {current.criteria ?? defaultCriteria}
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Full lead detail as a slide-over — the queue stays behind it. */}
      <LeadDetailSheet
        lead={detail}
        onClose={() => setDetail(null)}
        onPatch={(patch) => setDetail((d) => (d ? { ...d, ...patch } : d))}
      />
    </div>
  );
}
