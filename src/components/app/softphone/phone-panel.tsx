"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Delete,
  Grid3x3,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  Pause,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  Play,
  Plug,
  RefreshCw,
  Send,
  X,
} from "lucide-react";
import { listRecentCalls, lookupLeadByPhone, sendSmsToNumber, type RecentCall } from "@/lib/actions/phone";
import { smsSegments } from "@/lib/message-templates";
import { TemplatePicker } from "@/components/app/template-picker";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Softphone } from "./use-softphone";
import type { PhoneTab, PhoneUi } from "./softphone-provider";

/** mm:ss, counting from the moment the call was answered. */
function useElapsed(since: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since == null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [since]);
  if (since == null) return "";
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "+15105550142" → "(510) 555-0142", left alone if it isn't a US number. */
export function prettyNumber(raw: string): string {
  const d = raw.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length !== 10) return raw;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/** Keypad digits → something RingCentral will dial. 10 digits are assumed US. */
function toDialable(raw: string): string | null {
  const t = raw.trim();
  if (t.startsWith("+")) return /^\+\d{6,15}$/.test(t.replace(/[\s\-().]/g, "")) ? t.replace(/[\s\-().]/g, "") : null;
  const d = t.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (d.length >= 6) return `+${d}`;
  return null;
}

/**
 * Which lead a typed number belongs to. Resolved only once ten digits are
 * in; the lookup result is keyed by the number it answered for, so a stale
 * answer for a previous number is never shown.
 */
function useLeadForNumber(
  number: string,
  debounceMs: number,
): { leadId: string; name: string } | null {
  const [found, setFound] = useState<{ for: string; lead: { leadId: string; name: string } | null }>({
    for: "",
    lead: null,
  });
  const complete = number.replace(/\D/g, "").length >= 10;
  useEffect(() => {
    if (!complete) return;
    let active = true;
    const id = setTimeout(() => {
      lookupLeadByPhone(number)
        .then((lead) => active && setFound({ for: number, lead }))
        .catch(() => active && setFound({ for: number, lead: null }));
    }, debounceMs);
    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [number, complete, debounceMs]);
  return complete && found.for === number ? found.lead : null;
}

const KEYS: [string, string][] = [
  ["1", ""], ["2", "ABC"], ["3", "DEF"],
  ["4", "GHI"], ["5", "JKL"], ["6", "MNO"],
  ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"],
  ["*", ""], ["0", "+"], ["#", ""],
];

/**
 * The Vivo phone: a floating handset at the bottom-right of every page.
 * Collapsed it is a round button with a presence dot; open it is a small
 * phone with a keypad, the agent's recent calls and an SMS composer. During
 * a call the body becomes the in-call screen. Deliberately not a modal —
 * agents work the lead's record while they talk.
 */
export function PhonePanel({ phone, ui }: { phone: Softphone; ui: PhoneUi }) {
  const { call } = phone;
  const ringingInbound = call?.direction === "inbound" && call.state === "ringing";

  // An incoming call opens the phone by itself; nobody should hunt for it.
  useEffect(() => {
    if (ringingInbound) ui.open();
  }, [ringingInbound, ui]);

  if (!ui.isOpen) {
    return (
      <button
        type="button"
        onClick={() => ui.open()}
        title={statusTitle(phone)}
        aria-label="Open phone"
        className={cn(
          "fixed bottom-4 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full border bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105",
          call && "animate-pulse",
        )}
      >
        <Phone className="h-5 w-5" />
        <StatusDot phone={phone} className="absolute -right-0.5 -top-0.5 h-3 w-3 border-2 border-background" />
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Vivo phone"
      className={cn(
        "fixed bottom-4 right-4 z-50 flex w-[21rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl",
        ringingInbound && "border-success/50 ring-2 ring-success/25",
      )}
      style={{ height: "34rem", maxHeight: "calc(100vh - 2rem)" }}
    >
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <StatusDot phone={phone} className="h-2.5 w-2.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">Vivo Phone</p>
          <p className="truncate text-[11px] text-muted-foreground">{statusTitle(phone)}</p>
        </div>
        <button
          type="button"
          onClick={ui.close}
          aria-label="Minimize phone"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {call ? (
        <InCall phone={phone} />
      ) : phone.status === "unconfigured" ? (
        <NotConnected />
      ) : phone.status === "failed" ? (
        <Failed phone={phone} />
      ) : (
        <Body phone={phone} ui={ui} />
      )}
    </div>
  );
}

function statusTitle(phone: Softphone): string {
  switch (phone.status) {
    case "registered":
      return `Ready${phone.extensionNumber ? ` · ext ${phone.extensionNumber}` : ""}`;
    case "connecting":
      return "Connecting to RingCentral…";
    case "failed":
      return "Phone offline";
    default:
      return "Not connected";
  }
}

function StatusDot({ phone, className }: { phone: Softphone; className?: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full",
        phone.status === "registered" && "bg-success",
        phone.status === "connecting" && "animate-pulse bg-amber-500",
        phone.status === "failed" && "bg-destructive",
        phone.status === "unconfigured" && "bg-muted-foreground/50",
        className,
      )}
    />
  );
}

// ── States ───────────────────────────────────────────────────────────────────

/** Starts the RingCentral OAuth flow and comes back to this very page. */
function connectRingCentral() {
  window.location.href = `/api/ringcentral/start?return=${encodeURIComponent(
    window.location.pathname + window.location.search,
  )}`;
}

function NotConnected() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <Phone className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">Connect your RingCentral</p>
      <p className="text-xs text-muted-foreground">
        Once connected, this phone calls and texts leads from your own number
        and logs every touch on the lead automatically.
      </p>
      <Button size="sm" onClick={connectRingCentral}>
        <Plug className="mr-1.5 h-3.5 w-3.5" />
        Connect RingCentral
      </Button>
    </div>
  );
}

function Failed({ phone }: { phone: Softphone }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <AlertTriangle className="h-8 w-8 text-destructive" />
      <p className="text-sm font-medium text-destructive">Phone offline</p>
      <p className="text-xs text-muted-foreground">
        {phone.error ?? "The phone could not register."} You can still be
        reached on your RingCentral desk phone or mobile app.
      </p>
      <Button size="sm" variant="outline" onClick={phone.reconnect}>
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
        Try again
      </Button>
    </div>
  );
}

// ── Idle body: Keypad · Recent · Messages ────────────────────────────────────

function Body({ phone, ui }: { phone: Softphone; ui: PhoneUi }) {
  const tabs: { id: PhoneTab; label: string; icon: typeof Phone }[] = [
    { id: "keypad", label: "Keypad", icon: Grid3x3 },
    { id: "recent", label: "Recent", icon: Phone },
    { id: "messages", label: "Messages", icon: MessageSquare },
  ];
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {ui.tab === "keypad" && <Keypad phone={phone} ui={ui} />}
        {ui.tab === "recent" && <Recent phone={phone} ui={ui} />}
        {ui.tab === "messages" && <Messages ui={ui} />}
      </div>
      <nav className="grid grid-cols-3 border-t">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => ui.setTab(t.id)}
            className={cn(
              "flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors",
              ui.tab === t.id ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </nav>
    </>
  );
}

function Keypad({ phone, ui }: { phone: Softphone; ui: PhoneUi }) {
  const number = ui.number;
  const [dialing, setDialing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Caller-id for whatever's typed: a lead's name beats a bare number.
  const who = useLeadForNumber(number, 250);

  const press = (k: string) => ui.setNumber(number + k);
  const back = () => ui.setNumber(number.slice(0, -1));

  const dial = async () => {
    const target = toDialable(number);
    if (!target) {
      toast.error("Enter a full phone number.");
      return;
    }
    if (phone.status !== "registered") {
      toast.error("The phone is still connecting — try again in a moment.");
      return;
    }
    setDialing(true);
    try {
      await phone.dial(target);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not place the call");
    } finally {
      setDialing(false);
    }
  };

  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-2 text-center">
        <input
          ref={inputRef}
          value={number}
          onChange={(e) => ui.setNumber(e.target.value.replace(/[^\d+*#\s\-().]/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && void dial()}
          placeholder="Enter a number"
          inputMode="tel"
          className="w-full bg-transparent text-center text-2xl font-semibold tracking-wide outline-none placeholder:text-base placeholder:font-normal placeholder:text-muted-foreground"
        />
        <p className="h-4 text-xs text-muted-foreground">
          {who ? who.name : number.replace(/\D/g, "").length >= 10 ? prettyNumber(number) : " "}
        </p>
      </div>

      <div className="grid flex-1 grid-cols-3 gap-2 px-2">
        {KEYS.map(([k, letters]) => (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            onContextMenu={(e) => {
              // Long-press "0" on a phone gives "+"; right-click stands in here.
              if (k === "0") {
                e.preventDefault();
                press("+");
              }
            }}
            className="flex flex-col items-center justify-center rounded-xl bg-muted/50 py-2 text-xl font-medium transition-colors hover:bg-muted active:bg-muted-foreground/20"
          >
            {k}
            <span className="h-3 text-[9px] font-semibold tracking-widest text-muted-foreground">
              {letters}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-3 items-center px-2">
        <button
          type="button"
          onClick={() => {
            ui.setTab("messages");
          }}
          disabled={!toDialable(number)}
          title="Text this number"
          className="justify-self-start rounded-full p-3 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
        >
          <MessageSquare className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => void dial()}
          disabled={dialing || !number}
          aria-label="Call"
          className="flex h-14 w-14 items-center justify-center justify-self-center rounded-full bg-success text-white shadow-md transition-transform hover:scale-105 disabled:opacity-40"
        >
          {dialing ? <Loader2 className="h-6 w-6 animate-spin" /> : <Phone className="h-6 w-6" />}
        </button>
        <button
          type="button"
          onClick={back}
          disabled={!number}
          aria-label="Delete"
          className="justify-self-end rounded-full p-3 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
        >
          <Delete className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

function Recent({ phone, ui }: { phone: Softphone; ui: PhoneUi }) {
  const [calls, setCalls] = useState<RecentCall[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    listRecentCalls(40)
      .then((r) => {
        setCalls(r);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load calls."));

  // Reload when the tab is shown and after every call ends.
  const lastCall = phone.call?.state;
  useEffect(() => {
    void load();
  }, [lastCall]);

  const callBack = async (n: string) => {
    if (phone.status !== "registered") {
      toast.error("The phone is still connecting — try again in a moment.");
      return;
    }
    try {
      await phone.dial(n);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not place the call");
    }
  };

  if (error) return <p className="p-4 text-sm text-destructive">{error}</p>;
  if (calls === null)
    return (
      <p className="flex items-center gap-1.5 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
      </p>
    );
  if (calls.length === 0)
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        No calls yet. Your calls from this phone show up here.
      </p>
    );

  return (
    <ul className="divide-y">
      {calls.map((c) => {
        const Icon = c.missed ? PhoneMissed : c.direction === "inbound" ? ArrowDownLeft : ArrowUpRight;
        return (
          <li key={c.id} className="flex items-center gap-2 px-3 py-2">
            <Icon
              className={cn(
                "h-4 w-4 shrink-0",
                c.missed ? "text-destructive" : c.direction === "inbound" ? "text-success" : "text-muted-foreground",
              )}
            />
            <div className="min-w-0 flex-1">
              <p className={cn("truncate text-sm", c.missed && "text-destructive")}>
                {c.leadId && c.leadName ? (
                  <Link href={`/leads?lead=${c.leadId}`} className="hover:underline" title="Open lead">
                    {c.leadName}
                  </Link>
                ) : (
                  prettyNumber(c.number || "Unknown")
                )}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {c.leadName ? `${prettyNumber(c.number)} · ` : ""}
                {formatDistanceToNowStrict(c.startTime, { addSuffix: true })}
                {c.durationSec > 0 ? ` · ${Math.floor(c.durationSec / 60)}:${String(c.durationSec % 60).padStart(2, "0")}` : ""}
              </p>
            </div>
            {c.number && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    ui.setNumber(c.number);
                    ui.setTab("messages");
                  }}
                  title="Text"
                  className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <MessageSquare className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => void callBack(c.number)}
                  title="Call back"
                  className="rounded-full p-1.5 text-success hover:bg-success/10"
                >
                  <Phone className="h-4 w-4" />
                </button>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Messages({ ui }: { ui: PhoneUi }) {
  const [text, setText] = useState("");
  const [sending, startSend] = useTransition();
  const to = ui.number;
  const seg = smsSegments(text);
  const who = useLeadForNumber(to, 0);

  const send = () =>
    startSend(async () => {
      const r = await sendSmsToNumber(to, text);
      if (!r.ok) {
        toast.error(
          r.reason === "not_connected"
            ? "Connect RingCentral to send SMS."
            : r.reason === "bad_phone"
              ? "Enter a full phone number."
              : r.reason === "empty"
                ? "Write a message first."
                : (r.message ?? "Couldn't send the SMS."),
        );
        return;
      }
      toast.success(`SMS sent to ${who?.name ?? prettyNumber(to)}.`);
      setText("");
      if (r.leadId)
        window.dispatchEvent(new CustomEvent("lead-activity:refresh", { detail: { leadId: r.leadId } }));
    });

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div>
        <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">To</label>
        <input
          value={to}
          onChange={(e) => ui.setNumber(e.target.value.replace(/[^\d+\s\-().]/g, ""))}
          placeholder="Phone number"
          inputMode="tel"
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring"
        />
        <p className="h-4 text-[11px] text-muted-foreground">{who ? who.name : " "}</p>
      </div>
      <div className="flex items-center justify-between gap-2">
        <TemplatePicker
          channel="sms"
          lead={{ name: who?.name ?? null }}
          size="xs"
          onPick={(f) => setText(f.body)}
        />
        <span className={cn("text-[11px] text-muted-foreground", seg.segments > 3 && "text-amber-600")}>
          {seg.chars} · {seg.segments} SMS
        </span>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={1600}
        placeholder="Write a message…"
        className="min-h-0 flex-1 resize-none rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring"
      />
      <Button size="sm" onClick={send} disabled={sending || !text.trim() || !toDialable(to)}>
        {sending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
        Send SMS
      </Button>
    </div>
  );
}

// ── In-call screen ───────────────────────────────────────────────────────────

function InCall({ phone }: { phone: Softphone }) {
  const call = phone.call!;
  const elapsed = useElapsed(call.answeredAt);
  const [showKeys, setShowKeys] = useState(false);
  const [tones, setTones] = useState("");
  const ringingInbound = call.direction === "inbound" && call.state === "ringing";
  const live = call.state === "answered";

  const status = useMemo(() => {
    if (call.state === "ringing") return call.direction === "inbound" ? "Incoming call" : "Calling…";
    if (call.state === "answered") return call.held ? `On hold · ${elapsed}` : elapsed;
    if (call.state === "failed") return "Call failed";
    return "Call ended";
  }, [call.state, call.direction, call.held, elapsed]);

  const key = (k: string) => {
    phone.sendDtmf(k);
    setTones((t) => (t + k).slice(-24));
  };

  return (
    <div className={cn("flex flex-1 flex-col items-center p-5", call.state === "ended" && "opacity-70")}>
      <div className="mt-2 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        {call.direction === "inbound" ? (
          <PhoneIncoming className="h-7 w-7 text-success" />
        ) : (
          <Phone className="h-7 w-7 text-muted-foreground" />
        )}
      </div>
      <p className="mt-3 max-w-full truncate text-lg font-semibold">
        {call.remoteName ?? prettyNumber(call.remoteNumber)}
      </p>
      {call.remoteName && (
        <p className="text-xs text-muted-foreground">{prettyNumber(call.remoteNumber)}</p>
      )}
      <p className={cn("mt-1 text-sm", live ? "text-success" : "text-muted-foreground")}>{status}</p>

      {live && showKeys ? (
        <div className="mt-4 w-full">
          <p className="mb-1 h-5 text-center font-mono text-sm tracking-widest text-muted-foreground">{tones}</p>
          <div className="grid grid-cols-3 gap-2 px-4">
            {KEYS.map(([k]) => (
              <button
                key={k}
                type="button"
                onClick={() => key(k)}
                className="rounded-xl bg-muted/50 py-2 text-lg font-medium hover:bg-muted"
              >
                {k}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1" />
      )}

      <div className="mt-4 flex w-full flex-col items-center gap-3">
        {live && (
          <div className="grid w-full grid-cols-3 gap-2 px-2">
            <RoundAction
              on={call.muted}
              label={call.muted ? "Unmute" : "Mute"}
              onClick={phone.toggleMute}
              icon={call.muted ? MicOff : Mic}
            />
            <RoundAction
              on={showKeys}
              label="Keypad"
              onClick={() => setShowKeys((v) => !v)}
              icon={Grid3x3}
            />
            <RoundAction
              on={call.held}
              label={call.held ? "Resume" : "Hold"}
              onClick={() => void phone.toggleHold()}
              icon={call.held ? Play : Pause}
            />
          </div>
        )}

        <div className="flex items-center gap-6">
          {ringingInbound ? (
            <>
              <button
                type="button"
                onClick={() => void phone.decline()}
                aria-label="Decline"
                className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive text-white shadow-md hover:scale-105"
              >
                <PhoneOff className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={() => void phone.answer()}
                aria-label="Answer"
                className="flex h-14 w-14 animate-pulse items-center justify-center rounded-full bg-success text-white shadow-md hover:scale-105"
              >
                <Phone className="h-6 w-6" />
              </button>
            </>
          ) : call.state !== "ended" && call.state !== "failed" ? (
            <button
              type="button"
              onClick={() => void phone.hangup()}
              aria-label={live ? "End call" : "Cancel"}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive text-white shadow-md hover:scale-105"
            >
              <PhoneOff className="h-6 w-6" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function RoundAction({
  on,
  label,
  onClick,
  icon: Icon,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
  icon: typeof Mic;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className="flex flex-col items-center gap-1 text-[11px] text-muted-foreground"
    >
      <span
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-full transition-colors",
          on ? "bg-primary text-primary-foreground" : "bg-muted/60 hover:bg-muted",
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      {label}
    </button>
  );
}
