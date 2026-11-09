"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BellRing, Bell, PhoneCall } from "lucide-react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { listMyCallbacks, type PendingCallback } from "@/lib/actions/callbacks";
import {
  callbackUrgency,
  worstUrgency,
  URGENCY_BG,
  URGENCY_LABEL,
  URGENCY_TEXT,
} from "@/lib/callback-urgency";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const POLL_MS = 60_000;

/**
 * Header reminder for the agent's scheduled callbacks. The bell takes the
 * colour of the most pressing one — grey while everything is hours away,
 * amber within 4 h, orange within the hour, red (and ringing) once due — and
 * opens a list sorted by time. Re-checks every minute and on tab focus, so a
 * callback set from the queue shows up here without a reload.
 */
export function CallbackBell() {
  const [items, setItems] = useState<PendingCallback[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setItems(await listMyCallbacks());
    } catch {
      /* keep the last list; the next tick retries */
    }
    setNow(Date.now());
  }, []);

  useEffect(() => {
    // First load on the next tick (state updates belong in callbacks).
    const first = setTimeout(() => void load(), 0);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    // A callback scheduled or a lead touched elsewhere in the app.
    window.addEventListener("lead-activity:refresh", onFocus);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("lead-activity:refresh", onFocus);
    };
  }, [load]);

  const worst = worstUrgency(items.map((i) => i.callBackAt), now);
  const dueCount = items.filter((i) => callbackUrgency(i.callBackAt, now) === "due").length;
  const Icon = worst === "due" ? BellRing : Bell;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative h-8 w-8"
            aria-label={
              items.length
                ? `${items.length} pending callback${items.length === 1 ? "" : "s"}`
                : "No pending callbacks"
            }
            title={worst ? `Callbacks: ${URGENCY_LABEL[worst].toLowerCase()}` : "No pending callbacks"}
          />
        }
      >
        <Icon
          className={cn(
            "h-4 w-4 transition-colors",
            worst ? URGENCY_TEXT[worst] : "text-muted-foreground/60",
            worst === "due" && "animate-pulse",
          )}
        />
        {items.length > 0 && (
          <span
            className={cn(
              "absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white",
              URGENCY_BG[worst ?? "calm"],
            )}
          >
            {dueCount || items.length}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2">
          <p className="text-sm font-medium">Callbacks</p>
          <p className="text-xs text-muted-foreground">
            {items.length === 0
              ? "Nothing scheduled. Pick “Requested a callback” in the queue to set one."
              : `${items.length} pending · colour tightens as the time nears`}
          </p>
        </div>
        {items.length > 0 && (
          <ul className="max-h-80 divide-y overflow-y-auto">
            {items.map((i) => {
              const u = callbackUrgency(i.callBackAt, now);
              const at = new Date(i.callBackAt);
              return (
                <li key={i.leadId}>
                  <Link
                    href={`/leads?lead=${i.leadId}`}
                    className="flex items-start gap-2.5 px-3 py-2.5 hover:bg-muted/60"
                  >
                    <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", URGENCY_BG[u])} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{i.name}</span>
                        <span className={cn("shrink-0 text-xs font-medium", URGENCY_TEXT[u])}>
                          {u === "due"
                            ? at.getTime() < now - 60_000
                              ? `${formatDistanceToNowStrict(at)} ago`
                              : "Now"
                            : `in ${formatDistanceToNowStrict(at)}`}
                        </span>
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {format(at, "EEE MMM d · h:mm a")}
                        {i.campaign ? ` · ${i.campaign}` : ""}
                      </span>
                    </span>
                    <PhoneCall className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t px-3 py-2 text-right">
          <Link href="/leads/queue" className="text-xs text-primary hover:underline">
            Open the contact queue
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
