"use client";

import { createContext, useContext } from "react";
import { SoftphonePanel } from "./softphone-panel";
import { useSoftphone, type Softphone } from "./use-softphone";

/**
 * Makes one softphone registration available to the whole app.
 *
 * One per session, deliberately: RingCentral allows a single registration per
 * extension, so a second one anywhere in the tree would silently take the
 * first one's calls. Mounted once in the app layout; everything else reaches
 * it through `useSoftphoneContext`.
 */

const SoftphoneContext = createContext<Softphone | null>(null);

export function SoftphoneProvider({
  connected,
  children,
}: {
  /** Whether this user has RingCentral connected — no tokens, no phone. */
  connected: boolean;
  children: React.ReactNode;
}) {
  const phone = useSoftphone(connected);
  return (
    <SoftphoneContext.Provider value={phone}>
      {children}
      <SoftphonePanel phone={phone} />
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
