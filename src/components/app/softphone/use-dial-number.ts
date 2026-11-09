"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { usePhoneUi, useSoftphoneContext } from "./softphone-provider";

/**
 * Dials a number through the Vivo phone from anywhere in the app — the lead
 * panel's phone number, the Call button, the queue.
 *
 * Replaces `tel:` links: with no embedded widget left to intercept them, a
 * `tel:` click hands the number to the OS, which asks to open Edge/Skype/
 * whatever claims the scheme. The phone itself handles the not-connected and
 * still-connecting cases by opening on its Connect screen with a hint.
 */
export function useDialNumber(): (number: string | null | undefined) => void {
  const softphone = useSoftphoneContext();
  const phoneUi = usePhoneUi();
  return useCallback(
    (number) => {
      if (!number || number === "—") return;
      if (!softphone || softphone.status === "unconfigured" || softphone.status === "failed") {
        phoneUi?.open();
        toast.error("Connect your RingCentral in the phone to call from here.");
        return;
      }
      if (softphone.status === "connecting") {
        phoneUi?.open();
        toast.error("Your phone is still connecting — try again in a moment.");
        return;
      }
      phoneUi?.open();
      softphone.dial(number).catch((e: unknown) =>
        toast.error(e instanceof Error ? e.message : "Could not place the call"),
      );
    },
    [softphone, phoneUi],
  );
}
