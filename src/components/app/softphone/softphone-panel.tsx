"use client";

import { useEffect, useState } from "react";
import {
  Mic,
  MicOff,
  Pause,
  Phone,
  PhoneIncoming,
  PhoneOff,
  Play,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Softphone } from "./use-softphone";

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
function prettyNumber(raw: string): string {
  const d = raw.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length !== 10) return raw;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/**
 * The in-call surface. Deliberately a small fixed card rather than a modal:
 * agents work the lead's record while they talk, so the call must never cover
 * what the conversation is about.
 */
export function SoftphonePanel({ phone }: { phone: Softphone }) {
  const { call } = phone;
  const elapsed = useElapsed(call?.answeredAt ?? null);

  if (phone.status === "failed") {
    return (
      <div className="fixed bottom-4 right-4 z-50 w-80 rounded-xl border border-destructive/30 bg-background p-3 shadow-lg">
        <p className="flex items-center gap-2 text-sm font-medium text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Phone offline
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {phone.error ?? "The softphone could not register."} You can still be
          reached on your RingCentral desk phone or mobile app.
        </p>
        <Button size="sm" variant="outline" className="mt-2" onClick={phone.reconnect}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          Try again
        </Button>
      </div>
    );
  }

  if (!call) return null;

  const ringingInbound = call.direction === "inbound" && call.state === "ringing";
  const live = call.state === "answered";

  return (
    <div
      className={cn(
        "fixed bottom-4 right-4 z-50 w-80 rounded-xl border bg-background p-4 shadow-lg",
        ringingInbound && "border-success/40 ring-2 ring-success/20",
        call.state === "ended" && "opacity-70",
      )}
      role="dialog"
      aria-label="Active call"
    >
      <div className="flex items-center gap-2">
        {call.direction === "inbound" ? (
          <PhoneIncoming className="h-4 w-4 shrink-0 text-success" />
        ) : (
          <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            {call.remoteName ?? prettyNumber(call.remoteNumber)}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {call.state === "ringing"
              ? call.direction === "inbound"
                ? "Incoming call"
                : "Ringing…"
              : call.state === "answered"
                ? `On call · ${elapsed}`
                : call.state === "failed"
                  ? "Call failed"
                  : "Call ended"}
            {call.remoteName ? ` · ${prettyNumber(call.remoteNumber)}` : ""}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {ringingInbound && (
          <>
            <Button size="sm" onClick={() => void phone.answer()}>
              <Phone className="mr-1 h-3.5 w-3.5" />
              Answer
            </Button>
            <Button size="sm" variant="outline" onClick={() => void phone.decline()}>
              Decline
            </Button>
          </>
        )}

        {live && (
          <>
            <Button
              size="sm"
              variant={call.muted ? "default" : "outline"}
              onClick={phone.toggleMute}
              aria-pressed={call.muted}
            >
              {call.muted ? (
                <MicOff className="mr-1 h-3.5 w-3.5" />
              ) : (
                <Mic className="mr-1 h-3.5 w-3.5" />
              )}
              {call.muted ? "Unmute" : "Mute"}
            </Button>
            <Button
              size="sm"
              variant={call.held ? "default" : "outline"}
              onClick={() => void phone.toggleHold()}
              aria-pressed={call.held}
            >
              {call.held ? (
                <Play className="mr-1 h-3.5 w-3.5" />
              ) : (
                <Pause className="mr-1 h-3.5 w-3.5" />
              )}
              {call.held ? "Resume" : "Hold"}
            </Button>
          </>
        )}

        {call.state !== "ended" && call.state !== "failed" && !ringingInbound && (
          <Button size="sm" variant="destructive" onClick={() => void phone.hangup()}>
            <PhoneOff className="mr-1 h-3.5 w-3.5" />
            {live ? "End" : "Cancel"}
          </Button>
        )}
      </div>
    </div>
  );
}
