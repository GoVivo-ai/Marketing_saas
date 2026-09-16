"use client";

import { createContext, useContext } from "react";
import { RingCentralDialer } from "@/components/app/ringcentral-dialer";
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
  workspaceId,
  children,
}: {
  /** Whether this user has RingCentral connected — no tokens, no phone. */
  connected: boolean;
  /** Namespaces the fallback widget's session, as the layout does. */
  workspaceId: string;
  children?: React.ReactNode;
}) {
  const phone = useSoftphone(connected);
  // Only one registration per extension may be live — RingCentral gives the
  // calls to whichever registered last — so the embedded widget stays away
  // while ours is connecting or working. It comes back when there is no
  // softphone to use: an agent who cannot dial at all is the worse failure.
  const fallback = phone.status === "failed" || phone.status === "unconfigured";
  return (
    <SoftphoneContext.Provider value={phone}>
      {children}
      <SoftphonePanel phone={phone} />
      {fallback && <RingCentralDialer workspaceId={workspaceId} />}
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
