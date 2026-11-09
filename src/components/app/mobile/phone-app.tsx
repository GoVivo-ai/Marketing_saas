"use client";

import { useState } from "react";
import { Grid3x3, ListChecks, LogOut, MessageSquare, Phone } from "lucide-react";
import {
  Failed,
  InCall,
  Keypad,
  Messages,
  NotConnected,
  Recent,
  StatusDot,
  statusTitle,
  usePhoneUi,
  useSoftphoneContext,
  type PhoneTab,
} from "@/components/app/softphone";
import type { ContactQueueData } from "@/lib/data";
import { cn } from "@/lib/utils";
import { MobileQueue } from "./mobile-queue";

type Screen = "queue" | PhoneTab;

/**
 * The phone app's shell: the Vivo phone's own screens (keypad, recents,
 * messages, in-call) laid out as a handset, plus the agent's contact queue.
 *
 * The softphone and its UI state come from the same provider the desktop app
 * uses, so everything that already knows how to dial keeps working; only the
 * frame around it is different.
 */
export function PhoneApp({
  queue,
  hasQueue,
  workspaceName,
  userName,
  signOutAction,
}: {
  queue: ContactQueueData;
  hasQueue: boolean;
  workspaceName: string | null;
  userName: string | null;
  signOutAction: () => Promise<void>;
}) {
  const phone = useSoftphoneContext();
  const ui = usePhoneUi();
  // The queue is this shell's own screen; the other three are the phone's
  // tabs, which the phone's screens also switch between themselves.
  const [onQueue, setOnQueue] = useState(hasQueue);
  if (!phone || !ui) return null;

  const screen: Screen = onQueue ? "queue" : ui.tab;
  const go = (s: Screen) => {
    if (s === "queue") return setOnQueue(true);
    ui.setTab(s);
    setOnQueue(false);
  };

  const tabs: { id: Screen; label: string; icon: typeof Phone }[] = [
    ...(hasQueue ? [{ id: "queue" as const, label: "Queue", icon: ListChecks }] : []),
    { id: "keypad", label: "Keypad", icon: Grid3x3 },
    { id: "recent", label: "Recent", icon: Phone },
    { id: "messages", label: "Messages", icon: MessageSquare },
  ];

  const phoneScreen =
    phone.status === "unconfigured" ? (
      <NotConnected />
    ) : phone.status === "failed" ? (
      <Failed phone={phone} />
    ) : ui.tab === "keypad" ? (
      <Keypad phone={phone} ui={ui} />
    ) : ui.tab === "recent" ? (
      <Recent phone={phone} ui={ui} linkLeads={false} />
    ) : (
      <Messages ui={ui} />
    );

  return (
    <div
      className="mx-auto flex h-dvh w-full max-w-md flex-col bg-background"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <StatusDot phone={phone} className="h-2.5 w-2.5" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold leading-tight">
            {workspaceName ?? "Vivo Phone"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {statusTitle(phone)}
            {userName ? ` · ${userName}` : ""}
          </p>
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            aria-label="Sign out"
            className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </form>
      </header>

      {/* A call takes the whole screen; the queue stays mounted underneath so
          the lead the agent was on is still open when the call ends. */}
      <main className="relative flex min-h-0 flex-1 flex-col">
        {hasQueue && (
          <div className={cn("min-h-0 flex-1 flex-col", screen === "queue" && !phone.call ? "flex" : "hidden")}>
            <MobileQueue
              data={queue}
              onText={(number) => {
                ui.setNumber(number);
                go("messages");
              }}
            />
          </div>
        )}
        {phone.call ? (
          <InCall phone={phone} />
        ) : (
          screen !== "queue" && <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{phoneScreen}</div>
        )}
      </main>

      {!phone.call && (
        <nav
          className="grid shrink-0 border-t"
          style={{
            gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`,
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => go(t.id)}
              aria-current={screen === t.id ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium",
                screen === t.id ? "text-primary" : "text-muted-foreground",
              )}
            >
              <t.icon className="h-5 w-5" />
              {t.label}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
