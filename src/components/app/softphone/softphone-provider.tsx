"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { PhonePanel } from "./phone-panel";
import { useSoftphone, type Softphone } from "./use-softphone";

/**
 * Makes one softphone registration available to the whole app, and renders
 * the Vivo phone that drives it.
 *
 * One per session, deliberately: RingCentral allows a single registration per
 * extension, so a second one anywhere in the tree would silently take the
 * first one's calls. Mounted once in the app layout; everything else reaches
 * it through `useSoftphoneContext` / `usePhoneUi`.
 *
 * There is no embedded RingCentral widget any more: an agent without a
 * connected RingCentral sees the phone's Connect screen instead.
 */

export type PhoneTab = "keypad" | "recent" | "messages";

/** The phone's own window state — open/closed, which tab, what's typed. */
export interface PhoneUi {
  isOpen: boolean;
  tab: PhoneTab;
  number: string;
  open: (opts?: { tab?: PhoneTab; number?: string }) => void;
  close: () => void;
  setTab: (tab: PhoneTab) => void;
  setNumber: (n: string) => void;
}

const SoftphoneContext = createContext<Softphone | null>(null);
const PhoneUiContext = createContext<PhoneUi | null>(null);

export function SoftphoneProvider({
  connected,
  children,
}: {
  /** Whether this user has RingCentral connected — no tokens, no phone. */
  connected: boolean;
  children?: React.ReactNode;
}) {
  const phone = useSoftphone(connected);
  const [isOpen, setOpen] = useState(false);
  const [tab, setTab] = useState<PhoneTab>("keypad");
  const [number, setNumber] = useState("");

  const open = useCallback((opts?: { tab?: PhoneTab; number?: string }) => {
    if (opts?.tab) setTab(opts.tab);
    if (opts?.number !== undefined) setNumber(opts.number);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  const ui = useMemo<PhoneUi>(
    () => ({ isOpen, tab, number, open, close, setTab, setNumber }),
    [isOpen, tab, number, open, close],
  );

  return (
    <SoftphoneContext.Provider value={phone}>
      <PhoneUiContext.Provider value={ui}>
        {children}
        <PhonePanel phone={phone} ui={ui} />
      </PhoneUiContext.Provider>
    </SoftphoneContext.Provider>
  );
}

/**
 * The shared softphone, or null outside the provider — callers fall back to
 * their old path rather than crash, so a page that renders without the
 * provider still works.
 */
export function useSoftphoneContext(): Softphone | null {
  return useContext(SoftphoneContext);
}

/** The phone window: open it (optionally on a tab / with a number) from anywhere. */
export function usePhoneUi(): PhoneUi | null {
  return useContext(PhoneUiContext);
}
